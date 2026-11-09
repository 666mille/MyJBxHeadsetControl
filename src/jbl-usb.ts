// src/jbl-usb.ts
// Headset commands. Mute, game/chat balance and EQ go through the QuantumENGINE service
// when it runs (device-service.ts, eq-service.ts), everything else over HID (jbl-device.ts).
import streamDeck from "@elgato/streamdeck";
import { sendFeature, sendFeatureData, queryValue, syncFromDongle } from "./jbl-device";
import { updateState, readState } from "./state";
import { readPresets, buildInfo, computeCurve } from "./eq-engine";
import { switchEqViaService } from "./eq-service";
import { serviceUsable, serviceSetMute, serviceSetBalance, type SpatialMode } from "./device-service";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// One setting at a time, so quick double presses can't overtake each other.
let setQueue: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
    const next = setQueue.then(fn, fn);
    setQueue = next.catch(() => undefined);
    return next;
}

/** Waits a moment, then asks the dongle whether the value arrived. */
async function confirmValue(codeA: number, codeB: number, expected: number, delayMs: number): Promise<boolean> {
    await sleep(delayMs);
    return (await queryValue(codeA, codeB)) === expected;
}

/**
 * Sends a SET over HID and checks with a GET that the headset took it.
 * One retry; after that the caller reports the failure (key shows an alert).
 */
async function hidSetVerified(codeA: number, codeB: number, value: number): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (!sendFeature(codeA, codeB, value)) return false;
        if (await confirmValue(codeA, codeB, value, 150)) return true;
        streamDeck.logger.warn(`SET ${codeA.toString(16)}/${codeB.toString(16)} = ${value.toString(16)} not confirmed (attempt ${attempt + 1})`);
    }
    return false;
}

/**
 * Mute: through the QuantumENGINE service when it runs (its window follows),
 * otherwise or if that did not arrive, over HID. Always confirmed with a GET.
 */
export function setMute(on: boolean): Promise<boolean> {
    return queued(async () => {
        const v = on ? 0x80 : 0x00;
        let ok = serviceUsable() && (await serviceSetMute(on)) && (await confirmValue(0x03, 0x0c, v, 300));
        if (!ok) ok = await hidSetVerified(0x03, 0x0c, v);
        if (ok) updateState("muted", on);
        return ok;
    });
}

/** Toggles based on the real state from the dongle, not on what the plugin last saw. */
export async function toggleMute(): Promise<boolean> {
    await syncFromDongle([[0x03, 0x0c]]);
    return setMute(!readState().muted);
}

// ANC, Ambient Aware and spatial sound go straight over HID, even with QuantumENGINE
// running: the headset reports the change back like a button press on the earcup, the
// service picks that up and the QuantumENGINE window follows. Sent through the service
// instead (ANCStateProp, HXSpatialSoundTypeProp), the headset switches but the window
// is not told.

// ANC off (0x18 -> 0) turns off ANC and Ambient on the headset, so clear both flags.
export function setAnc(on: boolean): Promise<boolean> {
    return queued(async () => {
        const ok = await hidSetVerified(0x18, 0x00, on ? 0x80 : 0x00);
        if (ok) {
            updateState("anc", on);
            updateState("ambient_aware", false);
        }
        return ok;
    });
}

export function setAmbientAware(on: boolean): Promise<boolean> {
    return queued(async () => {
        const ok = await hidSetVerified(0x19, 0x00, on ? 0x80 : 0x00);
        if (ok) {
            updateState("ambient_aware", on);
            if (on) updateState("anc", false);
        }
        return ok;
    });
}

export function setSpatialSound(mode: SpatialMode): Promise<boolean> {
    return queued(async () => {
        const values = { off: 0x00, fixed: 0x81, headtracking: 0x82 };
        const ok = await hidSetVerified(0x21, 0x00, values[mode]);
        if (ok) updateState("spatial_sound", mode);
        return ok;
    });
}

/** Before toggling/cycling: read the real values, in case an event was missed. */
export const syncAncState = () => syncFromDongle([[0x18, 0x00], [0x19, 0x00]]);
export const syncSpatialState = () => syncFromDongle([[0x21, 0x00]]);

// The dial fires one step per tick: send each step over HID right away (instant),
// and hand the final value to QuantumENGINE once the dial rests, so its window follows.
const BALANCE_SYNC_MS = 400;
let balanceSyncTimer: NodeJS.Timeout | null = null;

export function setChatBalance(chatPercent: number): number {
    chatPercent = Math.max(0, Math.min(100, chatPercent));
    if (sendFeature(0x14, 0x00, 128 + chatPercent)) {
        updateState("chat_balance", chatPercent);
    }
    if (balanceSyncTimer) clearTimeout(balanceSyncTimer);
    balanceSyncTimer = setTimeout(() => {
        balanceSyncTimer = null;
        if (serviceUsable()) serviceSetBalance(chatPercent);
    }, BALANCE_SYNC_MS);
    return chatPercent;
}

// Same order as QuantumENGINE: band info (0x0E02), short pause for the headset ack,
// then the coefficients (0x0E7F). Both blocks are built before anything is sent.
const EQ_BLOCK_PAUSE_MS = 150;

// Preferred: let QuantumENGINE switch the preset (same as clicking it there).
// Fallback without QuantumENGINE: compute and send the coefficients ourselves.
export async function applyEqPreset(name: string): Promise<void> {
    if (!readState().connected) throw new Error("Headset not connected");
    if ((await switchEqViaService(name)) === "ok") return;
    const preset = readPresets().presets.find((p) => p.name === name);
    if (!preset) throw new Error("Preset not found in q950.dat: " + name);
    const info = buildInfo(preset);
    const curve = computeCurve(preset); // throws if the self-test failed
    if (!sendFeatureData(0x02, 0x0e, info)) throw new Error("Sending 0x0E02 failed");
    await sleep(EQ_BLOCK_PAUSE_MS);
    // Only band info arrived -> headset may be muted until a full preset is sent
    if (!sendFeatureData(0x7f, 0x0e, curve)) throw new Error("Sending 0x0E7F failed, apply preset again");
    updateState("eq_preset", name);
}
