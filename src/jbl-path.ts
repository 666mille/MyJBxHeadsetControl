// src/jbl-path.ts
// Finds the HID collection of the JBL dongle that carries the vendor protocol
// (input report 0x86, feature report 0x88).
//
// Do NOT select by list position: the order returned by devices() is not stable.
// After a QuantumENGINE update (driver reinstall) Col04 moved from index 3 to
// index 0, and the old "matches[3]" logic opened Col03 (telephony), which never
// receives any 0x86 events -> plugin stuck on OFFLINE.
//
// Selection order:
//   1. usage page 0xff12 (fixed in the firmware's report descriptor)
//   2. path contains "&Col04" (what it has always been on Windows)
//   3. active probe: send the harmless poll QuantumENGINE itself sends every second.
//      Only the collection that declares feature report 0x88 accepts it, Windows
//      rejects it on all others. Works while the headset is powered off.
//
// No Stream Deck dependency, so test-eq.ts can use it as well.
import { HID, devices, type Device } from "node-hid";

export const VID = 0x0ecb;
export const PID = 0x2127;
export const INTERFACE = 5;
export const JBL_USAGE_PAGE = 0xff12;

type Log = (level: "info" | "warn" | "error", msg: string) => void;

const PROBE: number[] = (() => {
    const b = new Array<number>(64).fill(0);
    [0x88, 0x00, 0xdd, 0x04, 0x00, 0x01, 0x00, 0x02, 0x00, 0x43].forEach((v, i) => (b[i] = v));
    return b;
})();

export function listCollections(): Device[] {
    try {
        return devices().filter(
            (d) => d.vendorId === VID && d.productId === PID && d.interface === INTERFACE && !!d.path
        );
    } catch {
        return [];
    }
}

function describe(d: Device): string {
    return `usage_page=0x${(d.usagePage ?? 0).toString(16)} usage=0x${(d.usage ?? 0).toString(16)} ${d.path}`;
}

function probe(path: string): boolean {
    let h: HID | null = null;
    try {
        h = new HID(path);
        h.sendFeatureReport(PROBE);
        return true;
    } catch {
        return false;
    } finally {
        try { h?.close(); } catch { /* ignore */ }
    }
}

let cachedPath: string | null = null;

/** Returns the path of the protocol collection, or null if the dongle is absent or nothing fits. */
export function findJblPath(log: Log = () => {}, matches: Device[] = listCollections()): string | null {
    if (matches.length === 0) {
        cachedPath = null;
        return null;
    }

    // Cached path still present -> no new search (the watchdog calls this every 2 s)
    if (cachedPath && matches.some((d) => d.path === cachedPath)) return cachedPath;

    const byUsage = matches.find((d) => d.usagePage === JBL_USAGE_PAGE);
    if (byUsage) return (cachedPath = byUsage.path!);

    const byName = matches.find((d) => d.path!.toUpperCase().includes("&COL04"));
    if (byName) {
        log("warn", `JBL: usage page 0x${JBL_USAGE_PAGE.toString(16)} not found, using Col04 by name: ${describe(byName)}`);
        return (cachedPath = byName.path!);
    }

    log("warn", `JBL: usage page and Col04 not found, probing ${matches.length} collections`);
    for (const d of matches) {
        const ok = probe(d.path!);
        log("info", `JBL scan: ${ok ? "OK  " : "no  "} ${describe(d)}`);
        if (ok) return (cachedPath = d.path!);
    }

    log("error", "JBL scan: no collection accepted the probe");
    cachedPath = null;
    return null;
}
