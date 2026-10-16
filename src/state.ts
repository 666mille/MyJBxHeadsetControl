// src/state.ts
// In-memory state with change subscription. The state.json mirror is written
// batched (every 500 ms at most): the game/chat wheel fires one event per step,
// and a sync disk write per event would block the event loop.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.join(__dirname, "state.json");

let memoryState: Record<string, any> = {};

try {
    if (fs.existsSync(STATE_FILE)) {
        memoryState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
} catch {
    memoryState = {};
}

// Never restore the connection state from the file: it has to be proven by
// real headset events on every start.
memoryState.connected = false;
delete memoryState.dongle_present;

// --- Subscription ---
type Listener = () => void;
const listeners = new Set<Listener>();
let notifyPending = false;

export function onStateChange(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify(): void {
    if (notifyPending) return;
    notifyPending = true;
    setTimeout(() => {
        notifyPending = false;
        for (const cb of listeners) {
            try { cb(); } catch { /* ignore */ }
        }
    }, 20);
}

// --- Batched file mirror ---
const MIRROR_INTERVAL_MS = 500;
let mirrorTimer: NodeJS.Timeout | null = null;
let mirrorDirty = false;

function scheduleMirror(): void {
    mirrorDirty = true;
    if (mirrorTimer) return;
    mirrorTimer = setTimeout(() => {
        mirrorTimer = null;
        if (!mirrorDirty) return;
        mirrorDirty = false;
        try {
            const tmpFile = STATE_FILE + ".tmp";
            fs.writeFileSync(tmpFile, JSON.stringify(memoryState, null, 2), "utf-8");
            fs.renameSync(tmpFile, STATE_FILE);
        } catch { /* not critical, retried on next update */ }
    }, MIRROR_INTERVAL_MS);
}

export function readState(): any {
    return { ...memoryState };
}

export function updateState(key: string, value: any): void {
    if (memoryState[key] === value) return;
    memoryState[key] = value;
    notify();          // in-memory, right away
    scheduleMirror();  // disk, batched
}
