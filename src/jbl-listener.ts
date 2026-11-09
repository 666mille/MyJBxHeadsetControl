// src/jbl-listener.ts
// Parses incoming HID events into the state. The connection itself lives in jbl-device.ts.
//
// Events come from the DONGLE, which also sends packets while the headset is off.
// So only known status codes and IMU data count as "headset is on".
//
// data[3] is the category: 0x03 = event, 0x01 = answer to a GET (jbl-device.ts
// queryState), 0x02 = ack of a SET. The dongle answers GETs from its cache even
// while the headset is off, so answers update the values but are no sign of life;
// only 0x35 tells the real link state.
import { updateState, readState } from "./state";
import { startDevice, deliverGetAnswer, queryState } from "./jbl-device";
import { checkNow } from "./qe-service";

// Base station knob (Q950 base station = the dongle): event ID 0x0FA0, value 1 = pressed,
// 2 = released. QuantumENGINE runs whatever is assigned to the knob (footstep, mute, EQ, ...).
// After release, refresh everything right away so the keys follow without waiting for the poll.
const KNOB_REFRESH_DELAY_MS = 400;
let knobTimer: NodeJS.Timeout | null = null;
function onKnobReleased(): void {
    if (knobTimer) clearTimeout(knobTimer);
    knobTimer = setTimeout(() => {
        knobTimer = null;
        queryState();             // HID values from the dongle
        checkNow().catch(() => undefined); // footstep / EQ from the QuantumENGINE service
    }, KNOB_REFRESH_DELAY_MS);
}

// State starts as offline (see state.ts). The first real sign of life switches
// to online until the explicit 0x35 offline event or the dongle disappears.
// No timeout: events only arrive on changes.
function markAliveFn(): void {
    if (!readState().connected) {
        updateState("connected", true);
    }
}

function parseEvent(data: Buffer): void {
    if (data.length < 16 || data[0] !== 0x86 || data[1] !== 0x00 || data[2] !== 0xdd) return;

    // IMU data (head tracking) only comes from a powered-on headset
    if (data[7] === 0x1a) {
        markAliveFn();
        return;
    }

    const codeA = data[11];
    const codeB = data[12];
    const value = data[15];
    const markAlive = data[3] === 0x01 ? () => { /* cached answer */ } : markAliveFn;
    if (data[3] === 0x01) deliverGetAnswer(codeA, codeB, value);

    // knob of the base station: 86 00 dd 03 .. 08 00 00 00 a0 0f 02 00 <01|02> 00
    if (codeA === 0xa0 && codeB === 0x0f) {
        if (data[3] === 0x03 && value === 0x02) onKnobReleased();
        return; // dongle input, not a sign of life of the headset
    }

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
