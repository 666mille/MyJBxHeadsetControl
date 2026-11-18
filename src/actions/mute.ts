// src/actions/mute.ts
// Vier Manifest-States: 0=Live, 1=Muted, 2=Offline, 3=No Dongle.
// Bilder sind pro State in der Stream-Deck-Software frei belegbar
// (Pfeil neben dem "+"). Das Plugin schaltet NUR den State um --
// kein setImage, da vom Nutzer gesetzte Bilder Vorrang haetten und
// Plugin-Overlays dann unsichtbar waeren.
import streamDeck, { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SingletonAction } from "@elgato/streamdeck";
import { toggleMute } from "../jbl-usb";
import { readState, onStateChange } from "../state";
import { disconnectedIcon } from "../icons";

const STATE_LIVE = 0;
const STATE_MUTED = 1;
const STATE_OFFLINE = 2;
const STATE_NO_DONGLE = 3;

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.mute" })
export class MuteAction extends SingletonAction {
    // per action instance: with two keys of the same type, one must not overwrite the other's timer
    private intervals = new Map<string, NodeJS.Timeout>();
    private unsubs = new Map<string, () => void>();

    private stopTimers(id: string): void {
        const t = this.intervals.get(id);
        if (t) clearInterval(t);
        this.intervals.delete(id);
        this.unsubs.get(id)?.();
        this.unsubs.delete(id);
    }
    private settings: any = {};

    override async onWillAppear(ev: WillAppearEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        await this.refresh(ev.action);
        this.stopTimers(ev.action.id);
        this.unsubs.set(ev.action.id, onStateChange(() => { this.refresh(ev.action); }));
        this.intervals.set(ev.action.id, setInterval(() => { this.refresh(ev.action); }, 5000));
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        await this.refresh(ev.action);
    }

    override async onWillDisappear(ev: WillDisappearEvent) {
        this.stopTimers(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent) {
        try {
            if (readState().connected) {
                // reads the real state first, confirms afterwards, retries once
                if (!(await toggleMute())) await ev.action.showAlert();
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