// src/qe-ipc.ts
// Client for the QuantumENGINE service (QuantumServer.exe) via its own IPC.dll.
// Used for features that run on the PC instead of the headset (Footstep Booster).
//
// Flow (same as the QuantumENGINE UI):
//   QEIInitialize(logFile)                      once per process
//   QEIRegisterAsClient(port, id, info)         port from shared memory Global\QE_CONFIG_MEMORY
//   QEIConnectIPC(client, deviceId)             one channel per product, e.g.
//                                               "Q950/USB\VID_0ECB&PID_2127\<dongle serial>"
//   QEISendMsgToService / QEISendSyncMsgToService
//   QEICreateConsistentMsg(Subscribe)           -> Notify messages via the callback
//
// Messages: uint32 MsgID | uint32 total length | payload (packed).
// Strings:  uint32 byte length | UTF-16LE.
//
// Windows only, requires QuantumENGINE to be installed and its service running.
// The DLL is loaded from the QuantumENGINE folder and never shipped.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);

export const QE_DIR = "C:\\Program Files\\JBL\\QuantumENGINE";
const DEFAULT_PORT = 5712;
const SYNC_TIMEOUT_MS = 500;

let koffi: any = null;
let api: any = null;
let initialized = false;
let ipcCallbacksPtr: any = null; // stable memory, the DLL may keep the pointer
let msgCallback: any = null;

let hClient: any = null;
let hIpc: any = null;
let channelName = "";
let consistentMsgs: any[] = [];

type NotifyHandler = (id: number, payload: Buffer) => void;
let notifyHandler: NotifyHandler | null = null;

/** Receives Notify messages of subscribed properties (id, payload after the header). */
export function setNotifyHandler(h: NotifyHandler): void { notifyHandler = h; }

const isNull = (p: any) => p === null || p === undefined || p === 0n || p === 0;

function call<T = any>(fn: any, ...args: any[]): Promise<T> {
    // async FFI call: the event loop keeps running while the DLL waits
    return new Promise((resolve, reject) => {
        fn.async(...args, (err: any, res: T) => (err ? reject(err) : resolve(res)));
    });
}

function load(): void {
    if (api) return;
    if (process.platform !== "win32") throw new Error("QuantumENGINE IPC is Windows only");
    const dll = path.join(QE_DIR, "IPC.dll");
    if (!fs.existsSync(dll)) throw new Error("IPC.dll not found (QuantumENGINE installed?)");

    koffi = requireCjs("koffi");
    // let IPC.dll find its own dependencies
    process.env.PATH = QE_DIR + ";" + (process.env.PATH ?? "");
    const lib = koffi.load(dll);
    const k32 = koffi.load("kernel32.dll");

    const OnMsg = koffi.proto("void QeOnServiceMessage(void *ctx, void *msg)");
    const IpcCallbacks = koffi.struct("QeClientIpcCallbacks", { OnServiceMessage: koffi.pointer(OnMsg) });

    api = {
        init: lib.func("int QEIInitialize(const char *logPath)"),
        register: lib.func("void *QEIRegisterAsClient(uint16_t port, const char16_t *id, const char16_t *info, void *ctx, void *callbacks)"),
        unregister: lib.func("int QEIUnregisterClient(void *hClient)"),
        connect: lib.func("void *QEIConnectIPC(void *hClient, const char16_t *name, void *ctx, void *callbacks, int autoRelease)"),
        close: lib.func("int QEICloseClientIPC(void *hIpc)"),
        send: lib.func("int QEISendMsgToService(void *hIpc, const void *msg)"),
        sendSync: lib.func("void *QEISendSyncMsgToService(void *hIpc, const void *msg, uint32_t expectedId, uint32_t timeout)"),
        release: lib.func("void QEIReleaseMsg(void *msg)"),
        createConsistent: lib.func("void *QEICreateConsistentMsg(void *hIpc, const void *msg)"),
        destroyConsistent: lib.func("int QEIDestroyConsistentMsg(void *hMsg)"),
        openMapping: k32.func("void *OpenFileMappingW(uint32_t access, int inherit, const char16_t *name)"),
        mapView: k32.func("void *MapViewOfFile(void *h, uint32_t access, uint32_t offHigh, uint32_t offLow, size_t bytes)"),
        unmapView: k32.func("int UnmapViewOfFile(void *p)"),
        closeHandle: k32.func("int CloseHandle(void *h)"),
    };

    // Called by IPC.dll on its own thread; koffi runs it on the JS main thread while the
    // DLL waits, so the message stays valid until we return (autoRelease = 1).
    // All other DLL calls are async, so the main thread is never blocked inside the DLL.
    msgCallback = koffi.register((_ctx: any, msg: any) => {
        try {
            if (isNull(msg) || !notifyHandler) return;
            const len = koffi.decode(msg, 4, "uint32");
            if (len < 8 || len > 65536) return;
            const id = koffi.decode(msg, "uint32") & 0xffff;
            notifyHandler(id, Buffer.from(koffi.view(msg, len).slice(8)));
        } catch { /* never throw into the DLL */ }
    }, koffi.pointer(OnMsg));
    ipcCallbacksPtr = koffi.alloc(IpcCallbacks, 1);
    koffi.encode(ipcCallbacksPtr, IpcCallbacks, { OnServiceMessage: msgCallback });
}

/** IPC port published by the service: CONFIG_INFO { uint16 IPCPort; wchar_t Url[256]; } */
function readPort(): number {
    const FILE_MAP_READ = 0x0004;
    for (const name of ["Global\\QE_CONFIG_MEMORY", "QE_CONFIG_MEMORY"]) {
        const h = api.openMapping(FILE_MAP_READ, 0, name);
        if (isNull(h)) continue;
        try {
            const p = api.mapView(h, FILE_MAP_READ, 0, 0, 0);
            if (isNull(p)) continue;
            try {
                const port = koffi.decode(p, "uint16");
                if (port > 0) return port;
            } finally { api.unmapView(p); }
        } finally { api.closeHandle(h); }
    }
    return DEFAULT_PORT;
}

function initOnce(): void {
    if (initialized) return;
    const dir = path.join(os.tmpdir(), "MyJBxHeadsetControl");
    fs.mkdirSync(dir, { recursive: true });
    // needs a file path, a bare folder is rejected
    if (api.init(path.join(dir, "IPC.log")) !== 1) throw new Error("QEIInitialize failed");
    initialized = true;
}

/** Opens (or reuses) the channel: "new", "open", or false if the service is not reachable. */
export async function openChannel(name: string): Promise<"new" | "open" | false> {
    load();
    initOnce();
    if (hIpc && channelName === name) return "open";
    await closeChannel();

    if (isNull(hClient)) {
        const id = process.pid.toString(16).toUpperCase().padStart(16, "0");
        hClient = await call(api.register, readPort(), id, "QE_APPLICATION", null, null); // info as tested
        if (isNull(hClient)) { hClient = null; return false; }
        await new Promise((r) => setTimeout(r, 300)); // connection is set up in the background
    }
    const h = await call(api.connect, hClient, name, null, ipcCallbacksPtr, 1);
    if (isNull(h)) return false;
    hIpc = h;
    channelName = name;
    return "new";
}

/**
 * Subscribes to properties. Like QuantumENGINE, the Subscribe message is created as a
 * "consistent" message, which IPC.dll sends again by itself after a reconnect.
 * The service answers each with the current value as a Notify message.
 */
export async function subscribe(subscribeIds: number[]): Promise<number> {
    if (!hIpc) return 0;
    let ok = 0;
    for (const id of subscribeIds) {
        const h = await call(api.createConsistent, hIpc, header(id, 0));
        if (!isNull(h)) { consistentMsgs.push(h); ok++; }
    }
    return ok;
}

export async function closeChannel(): Promise<void> {
    const msgs = consistentMsgs;
    consistentMsgs = [];
    for (const m of msgs) { try { await call(api.destroyConsistent, m); } catch { /* ignore */ } }
    if (hIpc && api) { try { await call(api.close, hIpc); } catch { /* ignore */ } }
    hIpc = null;
    channelName = "";
}

/** Drops the client registration too (e.g. after the service restarted). */
export async function resetClient(): Promise<void> {
    await closeChannel();
    if (hClient && api) { try { await call(api.unregister, hClient); } catch { /* ignore */ } }
    hClient = null;
}

function header(id: number, payloadLen: number): Buffer {
    const b = Buffer.alloc(8 + payloadLen);
    b.writeUInt32LE(id, 0);
    b.writeUInt32LE(8 + payloadLen, 4);
    return b;
}

/** Sends a Get message and returns the payload of the response, or null on timeout. */
export async function getSync(getId: number, respId: number): Promise<Buffer | null> {
    if (!hIpc) return null;
    const p = await call(api.sendSync, hIpc, header(getId, 0), respId, SYNC_TIMEOUT_MS);
    if (isNull(p)) return null;
    try {
        const len = koffi.decode(p, 4, "uint32");
        if (len < 8 || len > 65536) return null;
        return Buffer.from(koffi.view(p, len).slice(8));
    } finally {
        api.release(p);
    }
}

export async function sendInt(id: number, value: number, unsigned = false): Promise<boolean> {
    if (!hIpc) return false;
    const b = header(id, 4);
    if (unsigned) b.writeUInt32LE(value >>> 0, 8); else b.writeInt32LE(value | 0, 8);
    return (await call<number>(api.send, hIpc, b)) !== 0;
}

export async function sendString(id: number, value: string): Promise<boolean> {
    if (!hIpc) return false;
    const s = Buffer.from(value, "utf16le");
    const b = header(id, 4 + s.length);
    b.writeUInt32LE(s.length, 8);
    s.copy(b, 12);
    return (await call<number>(api.send, hIpc, b)) !== 0;
}

/** Sends a message with an arbitrary packed payload (e.g. a 1-byte state or a struct). */
export async function sendPayload(id: number, payload: Buffer): Promise<boolean> {
    if (!hIpc) return false;
    const b = header(id, payload.length);
    payload.copy(b, 8);
    return (await call<number>(api.send, hIpc, b)) !== 0;
}

export function decodeString(payload: Buffer): string {
    if (payload.length < 4) return "";
    const n = payload.readUInt32LE(0);
    return payload.subarray(4, 4 + n).toString("utf16le");
}
