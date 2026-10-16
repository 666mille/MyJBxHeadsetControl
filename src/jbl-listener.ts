// src/jbl-listener.ts
// Parses incoming HID events into the state. The connection itself lives in jbl-device.ts.
//
// Events come from the DONGLE, which also sends packets while the headset is off.
// So only known status codes and IMU data count as "headset is on".
import { updateState, readState } from "./state";
import { startDevice } from "./jbl-device";

// State starts as offline (see state.ts). The first real sign of life switches
// to online until the explicit 0x35 offline event or the dongle disappears.
// No timeout: events only arrive on changes.
function markAlive(): void {
    if (!readState().connected) {
        updateState("connected", true);
    }
}

function parseEvent(data: Buffer): void {
    if (data.length < 16 || data[0] !== 0x86 || data[1] !== 0x00 || data[2] !== 0xdd) return;

    // IMU data (head tracking) only comes from a powered-on headset
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
        // Explicit connect/disconnect event. Keep the battery value.
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
    // Unknown codes are dongle packets, not a sign of life
}

export function startListener(): void {
    startDevice(parseEvent);
}
