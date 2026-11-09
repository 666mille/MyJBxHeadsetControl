// src/device-service.ts
// Headset settings through the QuantumENGINE service, so the QuantumENGINE window
// follows changes made on the Stream Deck. Without the service the plugin talks
// to the dongle directly (jbl-usb.ts), as before.
//
// Only the HIDV3 props are set this way (mute, balance): the service sends them to the
// headset AND tells its window. ANCStateProp and HXSpatialSoundTypeProp switch the
// headset but leave the window unaware, so ANC/ambient/spatial are sent over HID, where
// the headset's own report updates the window. They are still subscribed below to see
// changes made in QuantumENGINE.
//
// Message IDs from QuantumENGINE (QECommon.*Prop):
//   HIDV3MicMuteProp          1 byte, 0x80 = muted          Set 12669 / Sub 12672 / Notify 12670
//   HIDV3GameChatBalanceProp  1 byte, 0x80 | chat percent   Set 12615 / Sub 12618 / Notify 12616
//   ANCStateProp              1 byte, 0 off 1 ANC 2 talk-through 3 ambient
//                                                          (Set 20507) / Sub 20510 / Notify 20508
//   HXSpatialSoundTypeProp    int32 current, int32 previous, 0 off 1 fixed 2 head tracking 3 DTS
//                                                          (Set 20738) / Sub 20741 / Notify 20739
//
import streamDeck from "@elgato/streamdeck";
import { readState, updateState } from "./state";
import * as qe from "./qe-service";

export type SpatialMode = "off" | "fixed" | "headtracking";

const MSG = {
    muteSet: 12669, muteSub: 12672, muteNotify: 12670,
    balanceSet: 12615, balanceSub: 12618, balanceNotify: 12616,
    ancGet: 20506, ancResp: 20509, ancSub: 20510, ancNotify: 20508,
    spatialSub: 20741, spatialNotify: 20739,
};
const SPATIAL_FROM_INDEX: SpatialMode[] = ["off", "fixed", "headtracking", "off"];

// --- Notifications: changes made in QuantumENGINE ---------------------------------
// The headset usually reports these as HID events too; this is the second path.
function deviceNotify(fn: (p: Buffer) => void) {
    return (p: Buffer) => { if (!qe.inStartupWindow() && p.length) fn(p); };
}

qe.registerProp(MSG.muteSub, MSG.muteNotify, deviceNotify((p) => updateState("muted", (p[0] & 0x80) !== 0)));
qe.registerProp(MSG.balanceSub, MSG.balanceNotify, deviceNotify((p) => {
    if (p[0] & 0x80) updateState("chat_balance", Math.min(100, p[0] & 0x7f));
}));
qe.registerProp(MSG.ancSub, MSG.ancNotify, deviceNotify((p) => {
    updateState("anc", p[0] === 1);
    updateState("ambient_aware", p[0] === 3);
}));
qe.registerProp(MSG.spatialSub, MSG.spatialNotify, deviceNotify((p) => {
    if (p.length >= 4) updateState("spatial_sound", SPATIAL_FROM_INDEX[p.readInt32LE(0)] ?? "off");
}));

// Health check of the channel while it is open (the ANC Get answers reliably).
qe.registerPoller(async () => (await qe.getSync(MSG.ancGet, MSG.ancResp)) !== null);

/** Keeps the service connection open for the whole plugin lifetime. */
export function startDeviceService(): void {
    qe.acquireService();
}

/** Usable right now? Only then a setting goes through the service. */
export function serviceUsable(): boolean {
    return readState().qe_available === true && readState().connected === true;
}

async function send(id: number, payload: Buffer): Promise<boolean> {
    try {
        return await qe.serial(async () => (await qe.ensureChannel()) && qe.sendPayload(id, payload));
    } catch (err) {
        streamDeck.logger.warn(`QuantumENGINE send ${id} failed: ${err}`);
        return false;
    }
}

const byte = (v: number) => Buffer.from([v & 0xff]);

export const serviceSetMute = (on: boolean) => send(MSG.muteSet, byte(on ? 0x80 : 0x00));
export const serviceSetBalance = (chat: number) => send(MSG.balanceSet, byte(0x80 | Math.max(0, Math.min(100, chat))));
