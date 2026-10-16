// src/jbl-usb.ts
// Headset commands. Sending goes through the shared handle in jbl-device.ts.
import { sendFeature, sendFeatureData } from "./jbl-device";
import { updateState, readState } from "./state";
import { readPresets, buildInfo, computeCurve } from "./eq-engine";

export function setMute(on: boolean): void {
    if (sendFeature(0x03, 0x0c, on ? 0x80 : 0x00)) {
        updateState("muted", on);
    }
}

// ANC off (0x18 -> 0) turns off ANC and Ambient on the headset, so clear both flags.
export function setAnc(on: boolean): void {
    if (sendFeature(0x18, 0x00, on ? 0x80 : 0x00)) {
        updateState("anc", on);
        updateState("ambient_aware", false);
    }
}

export function setAmbientAware(on: boolean): void {
    if (sendFeature(0x19, 0x00, on ? 0x80 : 0x00)) {
        updateState("ambient_aware", on);
        if (on) updateState("anc", false);
    }
}

export function setSpatialSound(mode: "off" | "fixed" | "headtracking"): void {
    const values = { off: 0x00, fixed: 0x81, headtracking: 0x82 };
    if (sendFeature(0x21, 0x00, values[mode])) {
        updateState("spatial_sound", mode);
    }
}

export function setChatBalance(chatPercent: number): number {
    chatPercent = Math.max(0, Math.min(100, chatPercent));
    if (sendFeature(0x14, 0x00, 128 + chatPercent)) {
        updateState("chat_balance", chatPercent);
    }
    return chatPercent;
}

// Same order as QuantumENGINE: band info (0x0E02), short pause for the headset ack,
// then the coefficients (0x0E7F). Both blocks are built before anything is sent.
const EQ_BLOCK_PAUSE_MS = 150;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function applyEqPreset(name: string): Promise<void> {
    if (!readState().connected) throw new Error("Headset not connected");
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
