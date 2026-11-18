// src/actions/anc.ts
// Dreier-Zyklus: off -> Noise Cancelling -> Ambient Aware -> off
// WICHTIG: refresh() ruft NIE getSettings() auf -- das erzeugt ein
// didReceiveSettings-Event, dessen Handler wieder refresh() ruft ->
// Endlosschleife. Settings werden gecacht.
import streamDeck, { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SingletonAction } from "@elgato/streamdeck";
import { setAnc, setAmbientAware, syncAncState } from "../jbl-usb";
import { readState, onStateChange } from "../state";
import { svgIcon, disconnectedIcon } from "../icons";

type AncMode = "off" | "anc" | "ambient";
const MODES: AncMode[] = ["off", "anc", "ambient"];
const LABELS: Record<AncMode, string> = {
    off: "ANC\nOFF",
    anc: "NOISE\nCANCELLING",
    ambient: "AMBIENT\nAWARE",
};

function currentMode(): AncMode {
    const state = readState();
    if (state.anc) return "anc";
    if (state.ambient_aware) return "ambient";
    return "off";
}

function applyMode(mode: AncMode): Promise<boolean> {
    if (mode === "anc") return setAnc(true);
    if (mode === "ambient") return setAmbientAware(true);
    return setAnc(false);
}

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.anc" })
export class AncAction extends SingletonAction {
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
    private lastImage = "";

    override async onWillAppear(ev: WillAppearEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        await this.refresh(ev.action);
        this.stopTimers(ev.action.id);
        this.unsubs.set(ev.action.id, onStateChange(() => { this.refresh(ev.action); }));
        this.intervals.set(ev.action.id, setInterval(() => { this.refresh(ev.action); }, 5000));
    }

    override async onWillDisappear(ev: WillDisappearEvent) {
        this.stopTimers(ev.action.id);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        this.lastImage = "";
        await this.refresh(ev.action);
    }

    override async onKeyDown(ev: KeyDownEvent) {
        try {
            if (readState().connected) {
                await syncAncState(); // real state, in case an event was missed
                const next = MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length];
                if (!(await applyMode(next))) await ev.action.showAlert();
            }
        } catch (err) { streamDeck.logger.error(`ANC toggle failed: ${err}`); }
        await this.refresh(ev.action);
    }

    private async refresh(action: any) {
        try {
            if (!action.isKey || !action.isKey()) return;
            const s = this.settings;
            const state = readState();
            const hdr = s.showHeader === false ? "" : (s.headerText || "JBL");

            let image: string;
            const off = disconnectedIcon(state, s.offlineColor ?? "#808080", s.noDongleColor ?? "#5A1A1A", hdr);
            if (off) {
                image = off;
            } else {
                const mode = currentMode();
                const colors: Record<AncMode, string> = {
                    off: "#555555",
                    anc: s.ancColor ?? "#2E86C1",
                    ambient: s.ambientColor ?? "#8E44AD",
                };
                image = svgIcon(colors[mode], LABELS[mode], "#ffffff", hdr);
            }

            if (image === this.lastImage) return; // nichts geaendert
            this.lastImage = image;
            await action.setImage(image);
        } catch { /* nie werfen */ }
    }
}