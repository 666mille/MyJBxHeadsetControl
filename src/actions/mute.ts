// src/actions/mute.ts
// Vier Manifest-States: 0=Live, 1=Muted, 2=Offline, 3=No Dongle.
// Bilder sind pro State in der Stream-Deck-Software frei belegbar
// (Pfeil neben dem "+"). Das Plugin schaltet NUR den State um --
// kein setImage, da vom Nutzer gesetzte Bilder Vorrang haetten und
// Plugin-Overlays dann unsichtbar waeren.
import streamDeck, { action, KeyDownEvent, WillAppearEvent, SingletonAction } from "@elgato/streamdeck";
import { setMute } from "../jbl-usb";
import { readState, onStateChange } from "../state";

const STATE_LIVE = 0;
const STATE_MUTED = 1;
const STATE_OFFLINE = 2;
const STATE_NO_DONGLE = 3;

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.mute" })
export class MuteAction extends SingletonAction {
    private interval?: NodeJS.Timeout;
    private unsub?: () => void;

    override async onWillAppear(ev: WillAppearEvent) {
        await this.refresh(ev.action);
        this.unsub = onStateChange(() => { this.refresh(ev.action); });
        this.interval = setInterval(() => { this.refresh(ev.action); }, 5000);
    }

    override async onWillDisappear() {
        if (this.interval) clearInterval(this.interval);
        if (this.unsub) this.unsub();
    }

    override async onKeyDown(ev: KeyDownEvent) {
        try {
            if (readState().connected) {
                setMute(!readState().muted);
            }
        } catch (err) { streamDeck.logger.error(`setMute failed: ${err}`); }
        await this.refresh(ev.action);
    }

    private async refresh(action: any) {
        try {
            if (!action.isKey || !action.isKey()) return;
            const state = readState();

            let target: number;
            if (!state.connected) {
                target = state.dongle_present === false ? STATE_NO_DONGLE : STATE_OFFLINE;
            } else {
                target = state.muted ? STATE_MUTED : STATE_LIVE;
            }
            await action.setState(target);
        } catch { /* nie werfen */ }
    }
}