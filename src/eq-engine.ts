// src/eq-engine.ts
// Reads EQ presets from QuantumENGINE's q950.dat and computes the DSP coefficients
// (0x0E7F) with serializePEQ from the local JBL DLL. The DLL is not shipped.
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

// koffi is loaded on demand: if it fails, the rest of the plugin keeps running.
const requireCjs = createRequire(import.meta.url);
let koffi: any = null;
let EqSettings: any = null;

function loadKoffi(): void {
    if (koffi) return;
    koffi = requireCjs("koffi");
    const Param = koffi.struct("JblEqParam", {
        BandType: "int32", _pad: "int32", Gain: "double", Freq: "double", Q: "double",
    });
    EqSettings = koffi.struct("JblEqSettings", {
        Status: "int32", CategoryId: "int32", Index: "int32", Count: "int32",
        SampleRate: "int32", _pad: "int32",
        Calibration: "double", LeftGain: "double", RightGain: "double",
        Params: koffi.array(Param, 10),
    });
}

export const DAT_PATH = "C:\\ProgramData\\QuantumENGINE\\q950\\q950.dat";
const DLL_NAME = "libAirohaEQSerializeImp.dll";
const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const CUSTOM_EQID = 193; // all user presets use 0xC1
const SAMPLE_RATES = [44100, 48000, 88200, 96000];
const CURVE_LENGTH = 858;

const SYSTEM_IDS: Record<string, number> = {
    "FLAT": 0, "BASS BOOST": 80, "FPS": 84, "CINEMATIC": 86, "MOBA": 87, "RPG": 88,
    "LN3 Immersion": 89, "LN3 Thrill": 90, "CS2": 91, "LOL": 92, "Dota 2": 93,
    "Fortnite": 94, "Valorant": 95, "WoW": 96, "PUBG": 98, "GTA 5": 99,
    "Overwatch 2": 101, "Escape from Tarkov": 102, "Apex Legends": 104,
};

// FLAT as sent by QuantumENGINE (captured), used for the self-test
const FLAT_CURVE_HEX = "004c0304000000010067000a00906b0022ac9400cf166b00c8488000866f7f0097ff7f00ff9180005ddf7e00d29180005ddf7e00d2ff7f00ff2681005abd7d009a2681005abd7d009aff7f00ff518200ac857b0080518200ac857b0080ff7f00ffb684005b337700cdb684005b337700cdff7f00ffb289003a076f0092b289003a076f0092ff7f00ff4c9400ab736000b84c9400ab736000b8ff7f00ff20ab00719c49004720ab00719c490047ff7f00ff3adb00bd083000563adb00bd08300056ff7f00ff653c004d903900cb653c004d903900cbc204008f020067000a00906b0022a79400d9206b009f4280009e7b7f004dff7f00ff85800081f77e002485800081f77e0024ff7f00ff0e81003fec7d00360e81003fec7d0036ff7f00ff208200b4e17b001e208200b4e17b001eff7f00ff51840092e47700bc51840092e47700bcff7f00ffde8800af507000f4de8800af507000f4ff7f00ff87920037aa6200c887920037aa6200c8ff7f00ff51a700aacc4c00cd51a700aacc4c00cdff7f00ff56d300bfa532000556d300bfa5320005ff7f00ffa92c0041a5320005a92c0041a5320005c204008f050067000a00906b00228e94004e536b006424800039b77f00b7ff7f00ff488000866f7f0097488000866f7f0097ff7f00ff9280008add7e00829280008add7e0082ff7f00ff2681005abd7d009a2681005abd7d009aff7f00ff518200ac857b0080518200ac857b0080ff7f00ffb684005b337700cdb684005b337700cdff7f00ffb289003a076f0092b289003a076f0092ff7f00ff4c9400ab736000b84c9400ab736000b8ff7f00ff20ab00719c49004720ab00719c490047ff7f00ff3adb00bd083000563adb00bd08300056c204008f060067000a00906b00228b9400d4586b005221800047bd7f0095ff7f00ff4280009e7b7f004d4280009e7b7f004dff7f00ff86800096f57e000386800096f57e0003ff7f00ff0e81003fec7d00360e81003fec7d0036ff7f00ff208200b4e17b001e208200b4e17b001eff7f00ff51840092e47700bc51840092e47700bcff7f00ffde8800af507000f4de8800af507000f4ff7f00ff87920037aa6200c887920037aa6200c8ff7f00ff51a700aacc4c00cd51a700aacc4c00cdff7f00ff56d300bfa532000556d300bfa5320005c204008f0308000100000001000000";

export interface EqPreset {
    name: string;
    isSystem: boolean;
    eqId: number;
    freqs: number[];
    gains: number[];
    qs: number[];
}

// ---------- q950.dat (cached by mtime) ----------
let cache: { mtime: number; presets: EqPreset[]; current: string | null } | null = null;

export function readPresets(): { presets: EqPreset[]; current: string | null } {
    const mtime = fs.statSync(DAT_PATH).mtimeMs;
    if (cache && cache.mtime === mtime) return cache;

    const entries: any[] = JSON.parse(fs.readFileSync(DAT_PATH, "utf-8"));
    const byName: Record<string, any> = {};
    for (const e of entries) byName[e.Name] = e;

    // Edited state (IsModify) wins, same as QuantumENGINE shows it
    const chosen = new Map<string, any>();
    for (const p of byName["RenderEqPresetProf"]?.Value ?? []) {
        if (!chosen.has(p.Name) || p.IsModify) chosen.set(p.Name, p);
    }
    const presets: EqPreset[] = [];
    for (const p of chosen.values()) {
        const dl: any[] = p.DataList ?? [];
        const freqs = dl.map(d => Number(d.Frequency));
        if (freqs.join() !== FREQS.join()) continue; // unknown layout
        presets.push({
            name: p.Name,
            isSystem: !!p.IsSystem,
            eqId: p.IsSystem ? (SYSTEM_IDS[p.Name] ?? CUSTOM_EQID) : CUSTOM_EQID,
            freqs,
            gains: dl.map(d => Number(d.Gain)),
            qs: dl.map(d => Number(d.Q ?? 1)),
        });
    }
    const current = byName["RenderCurrentEqProf"]?.Value?.Name ?? null;
    cache = { mtime, presets, current };
    return cache;
}

// ---------- 0x0E02: band info ----------
export function buildInfo(p: EqPreset): Buffer {
    const name = Buffer.from(p.name, "utf8");
    const b = Buffer.alloc(19 + 13 * p.freqs.length + name.length);
    b.writeUInt8(p.eqId, 0);
    b.writeUInt8(1, 1);                 // category state
    b.writeUInt8(p.freqs.length, 2);    // band count
    b.writeFloatLE(0, 3);               // calibration
    b.writeUInt32LE(48000, 7);          // sample rate
    b.writeFloatLE(0, 11);              // left gain
    b.writeFloatLE(0, 15);              // right gain
    let o = 19;
    for (let i = 0; i < p.freqs.length; i++) {
        b.writeUInt8(1, o);
        b.writeFloatLE(p.freqs[i], o + 1);
        b.writeFloatLE(p.gains[i], o + 5);
        b.writeFloatLE(p.qs[i], o + 9);
        o += 13;
    }
    name.copy(b, o);
    return b;
}

// ---------- 0x0E7F: coefficients via the JBL DLL ----------
let serializeFn: ((...args: any[]) => number) | null = null;
let selfTestOk = false;
let lastError = "";

function findDll(configured?: string): string | null {
    if (configured && fs.existsSync(configured)) return configured;
    const roots = ["C:\\Program Files", "C:\\Program Files (x86)"];
    const walk = (dir: string, depth: number): string | null => {
        if (depth > 5) return null;
        let items: fs.Dirent[];
        try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
        for (const it of items) {
            const full = path.join(dir, it.name);
            if (it.isFile() && it.name.toLowerCase() === DLL_NAME.toLowerCase()) return full;
        }
        for (const it of items) {
            if (!it.isDirectory()) continue;
            // top level: only JBL/Harman/Quantum folders
            if (depth === 0 && !/jbl|harman|quantum/i.test(it.name)) continue;
            const r = walk(path.join(dir, it.name), depth + 1);
            if (r) return r;
        }
        return null;
    };
    for (const r of roots) {
        const found = walk(r, 0);
        if (found) return found;
    }
    return null;
}

export function initEngine(configuredDllPath?: string): { ok: boolean; dll: string | null; error: string } {
    selfTestOk = false; serializeFn = null;
    const dll = findDll(configuredDllPath);
    if (!dll) { lastError = "DLL not found"; return { ok: false, dll: null, error: lastError }; }
    try {
        loadKoffi();
        if (koffi.sizeof(EqSettings) !== 0x170) throw new Error("wrong struct size");
        // let the DLL find its dependencies in its own folder
        process.env.PATH = path.dirname(dll) + ";" + (process.env.PATH ?? "");
        const lib = koffi.load(dll);
        serializeFn = lib.func(
            "int serializePEQ(JblEqSettings *s, void *design, int designSize, int type, " +
            "int32_t *srList, int srN, _Out_ void **out, _Out_ int32_t *outLen)");
        // FLAT must match the captured blob byte for byte
        const flat = computeCurveUnchecked({ name: "FLAT", isSystem: true, eqId: 0,
            freqs: FREQS, gains: FREQS.map(() => 0), qs: FREQS.map(() => 1) });
        selfTestOk = flat.toString("hex") === FLAT_CURVE_HEX;
        lastError = selfTestOk ? "" : "self-test failed (FLAT mismatch)";
    } catch (err) {
        lastError = "could not load koffi/DLL: " + ((err as any)?.message ?? err);
    }
    return { ok: selfTestOk, dll, error: lastError };
}

function computeCurveUnchecked(p: EqPreset): Buffer {
    if (!serializeFn) throw new Error("EQ engine not initialized");
    const s = {
        Status: 1, CategoryId: p.eqId, Index: p.eqId, Count: p.freqs.length,
        SampleRate: 48000, _pad: 0, Calibration: 0, LeftGain: 0, RightGain: 0,
        Params: p.freqs.map((f, i) => ({ BandType: 2, _pad: 0, Gain: p.gains[i], Freq: f, Q: p.qs[i] })),
    };
    const out: any[] = [null];
    const len: number[] = [0];
    const rc = serializeFn(s, null, 0, 0, new Int32Array(SAMPLE_RATES), SAMPLE_RATES.length, out, len);
    if (rc !== 0 || !out[0] || len[0] <= 0) throw new Error("serializePEQ failed (rc=" + rc + ")");
    return Buffer.from(koffi.decode(out[0], koffi.array("uint8", len[0])) as number[]);
}

export function computeCurve(p: EqPreset): Buffer {
    if (!selfTestOk) throw new Error("EQ engine locked: " + (lastError || "not initialized"));
    const curve = computeCurveUnchecked(p);
    if (curve.length !== CURVE_LENGTH) throw new Error("unexpected blob length " + curve.length);
    return curve;
}

export function engineStatus() {
    return { ok: selfTestOk, error: lastError };
}
