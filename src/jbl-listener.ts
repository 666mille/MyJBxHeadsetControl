// src/jbl-listener.ts
// Parst die eingehenden HID-Events und schreibt sie in den State.
// Die Verbindung verwaltet jbl-device.ts (ein gemeinsamer Handle).
//
// WICHTIG: Die Events kommen vom DONGLE, nicht vom Headset selbst. Der
// Dongle sendet auch bei AUSGESCHALTETEM Headset periodische Pakete.
// Deshalb gilt NICHT jedes Paket als Lebenszeichen -- sonst wuerde das
// 0x35-Offline-Event sofort wieder von Dongle-Paketen ueberschrieben.
// Nur BEKANNTE Status-Codes und IMU-Daten beweisen: Headset ist an.
import { updateState, readState } from "./state";
import { startDevice } from "./jbl-device";

function markAlive(): void {
    if (!readState().connected) {
        updateState("connected", true);
    }
}

function parseEvent(data: Buffer): void {
    if (data.length < 16 || data[0] !== 0x86 || data[1] !== 0x00 || data[2] !== 0xdd) return;

    // IMU-Rohdaten: kommen nur bei eingeschaltetem Headset (Headtracking)
    if (data[7] === 0x1a) {
        markAlive();
        return;
    }

    const codeA = data[11];
    const codeB = data[12];
    const value = data[15];

    if (codeA === 0x0d && codeB === 0x00) {
        markAlive();
        updateState("battery", value);
    } else if (codeA === 0x03 && codeB === 0x0c) {
        markAlive();
        updateState("muted", value === 0x80);
    } else if (codeA === 0x35 && codeB === 0x00) {
        // Explizites Connect/Disconnect-Event -- die Autoritaet.
        // Batteriewert behalten (siehe jbl-device.ts).
        updateState("connected", value === 0x80);
    } else if (codeA === 0x18 && codeB === 0x00) {
        markAlive();
        updateState("anc", value === 0x80);
        if (value === 0x80) updateState("ambient_aware", false);
    } else if (codeA === 0x19 && codeB === 0x00) {
        markAlive();
        updateState("ambient_aware", value === 0x80);
        if (value === 0x80) updateState("anc", false);
    } else if (codeA === 0x14 && codeB === 0x00) {
        markAlive();
        updateState("chat_balance", value - 128);
    } else if (codeA === 0x21 && codeB === 0x00) {
        markAlive();
        const mode = value === 0x81 ? "fixed" : value === 0x82 ? "headtracking" : "off";
        updateState("spatial_sound", mode);
    }
    // Unbekannte Codes: NICHT als Lebenszeichen werten (Dongle-Pakete)
}

export function startListener(): void {
    startDevice(parseEvent);
}