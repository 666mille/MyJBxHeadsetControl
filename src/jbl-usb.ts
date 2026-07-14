// src/jbl-usb.ts
// Nur die Befehlsfunktionen. Das Senden laeuft ueber den gemeinsamen
// Handle in jbl-device.ts (dieselbe Collection, ueber die auch gelesen wird).
import { sendFeature } from "./jbl-device";
import { updateState } from "./state";

export function setMute(on: boolean): void {
    if (sendFeature(0x03, 0x0c, on ? 0x80 : 0x00)) {
        updateState("muted", on);
    }
}

// ANC an: setzt ambient_aware im State auf false.
// ANC aus (0x18 -> 0) schaltet auf der Hardware BEIDES ab (ANC + Ambient),
// deshalb im State auch beide Flags loeschen -- sonst zeigt der Button
// faelschlich noch "ambient".
export function setAnc(on: boolean): void {
    if (sendFeature(0x18, 0x00, on ? 0x80 : 0x00)) {
        updateState("anc", on);
        updateState("ambient_aware", false);
    }
}

// Ambient an: direktes Umschalten. Setzt anc im State auf false.
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