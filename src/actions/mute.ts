// src/actions/mute.ts
// Vier Manifest-States: 0=Live, 1=Muted, 2=Offline, 3=No Dongle.
// Bilder sind pro State in der Stream-Deck-Software frei belegbar
// (Pfeil neben dem "+"). Das Plugin schaltet NUR den State um --
// kein setImage, da vom Nutzer gesetzte Bilder Vorrang haetten und
// Plugin-Overlays dann unsichtbar waeren.
import streamDeck, { action, KeyDownEvent, WillAppearEvent, DidReceiveSettingsEvent, SingletonAction } from "@elgato/streamdeck";
import { setMute } from "../jbl-usb";
import { readState, onStateChange } from "../state";
import { disconnectedIcon } from "../icons";

const STATE_LIVE = 0;
const STATE_MUTED = 1;
const STATE_OFFLINE = 2;
const STATE_NO_DONGLE = 3;

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.mute" })
export class MuteAction extends SingletonAction {
    private interval?: NodeJS.Timeout;
    private unsub?: () => void;
    private settings: any = {};

    override async onWillAppear(ev: WillAppearEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        await this.refresh(ev.action);
        this.unsub = onStateChange(() => { this.refresh(ev.action); });
        this.interval = setInterval(() => { this.refresh(ev.action); }, 5000);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        await this.refresh(ev.action);
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
            const s = this.settings;
            const hdr = s.showHeader === false ? "" : (s.headerText || "JBL");

            if (!state.connected) {
                // Offline/No-Dongle als gerendertes SVG (mit Header + Farben)
                const off = disconnectedIcon(state, s.offlineColor ?? "#808080", s.noDongleColor ?? "#5A1A1A", hdr);
                if (off) { await action.setImage(off); return; }
            }
            // Verbunden: Mikrofon-Bilder der Manifest-States (Live/Muted).
            // setImage zuruecksetzen, damit die State-Bilder wieder greifen.
            await action.setImage();
            await action.setState(state.muted ? STATE_MUTED : STATE_LIVE);
        } catch { /* nie werfen */ }
    }
}