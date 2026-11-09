// src/eq-service.ts
// EQ presets through the QuantumENGINE service. Preferred over computing the
// coefficients ourselves (eq-engine.ts): the service does exactly what the
// QuantumENGINE window does, and the window follows the change right away.
// eq-engine.ts stays as the fallback when QuantumENGINE is not running.
//
// Message IDs from QuantumENGINE:
//   RenderEqCurrentPresetProp  string  Get 20993 / Resp 20995 / Sub 20996 / Notify 20994
//   RenderEqSwitchPresetProp   string  Command 21006 (preset name, as in q950.dat)
import { updateState } from "./state";
import * as qe from "./qe-service";

const MSG = { currentGet: 20993, currentResp: 20995, currentSub: 20996, currentNotify: 20994, switchCmd: 21006 };
const CONFIRM_TIMEOUT_MS = 2500;

let lastCurrent: string | null = null;
const onCurrent = (p: Buffer) => {
    const name = qe.decodeString(p);
    if (!name) return;
    lastCurrent = name;
    updateState("eq_preset", name);
};

// Notify arrives immediately when the preset is changed in QuantumENGINE.
qe.registerProp(MSG.currentSub, MSG.currentNotify, onCurrent);

let eqUsers = 0;
qe.registerPoller(async () => {
    if (eqUsers === 0) return true;
    const d = await qe.getSync(MSG.currentGet, MSG.currentResp);
    if (!d) return false;
    onCurrent(d);
    return true;
});

export function acquireEq(): void { eqUsers++; qe.acquireService(); }
export function releaseEq(): void { eqUsers = Math.max(0, eqUsers - 1); qe.releaseService(); }

/**
 * Switches the preset through the service.
 * "unavailable": service not reachable, caller may use the own DLL path.
 * Throws if the service is reachable but did not switch.
 */
export async function switchEqViaService(name: string): Promise<"ok" | "unavailable"> {
    return qe.serial(async () => {
        if (!(await qe.ensureChannel(true))) return "unavailable";
        if (!(await qe.sendString(MSG.switchCmd, name))) return "unavailable";
        const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 200));
            if (lastCurrent === name) break; // Notify already arrived
            const d = await qe.getSync(MSG.currentGet, MSG.currentResp);
            if (d) onCurrent(d);
            if (lastCurrent === name) break;
        }
        if (lastCurrent !== name) throw new Error(`QuantumENGINE did not switch to "${name}"`);
        updateState("qe_available", true);
        return "ok";
    });
}
