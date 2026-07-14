// src/actions/anc.ts
// Dreier-Zyklus: off -> Noise Cancelling -> Ambient Aware -> off
// WICHTIG: refresh() ruft NIE getSettings() auf -- das erzeugt ein
// didReceiveSettings-Event, dessen Handler wieder refresh() ruft ->
// Endlosschleife. Settings werden gecacht.
import streamDeck, { action, KeyDownEvent, WillAppearEvent, DidReceiveSettingsEvent, SingletonAction } from "@elgato/streamdeck";
import { setAnc, setAmbientAware } from "../jbl-usb";
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

function applyMode(mode: AncMode): void {
    if (mode === "anc") setAnc(true);
    else if (mode === "ambient") setAmbientAware(true);
    else setAnc(false);
}

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.anc" })
export class AncAction extends SingletonAction {
    private interval?: NodeJS.Timeout;
    private unsub?: () => void;
    private settings: any = {};
    private lastImage = "";

    override async onWillAppear(ev: WillAppearEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        await this.refresh(ev.action);
        this.unsub = onStateChange(() => { this.refresh(ev.action); });
        this.interval = setInterval(() => { this.refresh(ev.action); }, 5000);
    }

    override async onWillDisappear() {
        if (this.interval) clearInterval(this.interval);
        if (this.unsub) this.unsub();
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent) {
        this.settings = (ev.payload?.settings as any) ?? {};
        this.lastImage = "";
        await this.refresh(ev.action);
    }

    override async onKeyDown(ev: KeyDownEvent) {
        try {
            if (readState().connected) {
                const next = MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length];
                applyMode(next);
            }
        } catch (err) { streamDeck.logger.error(`ANC toggle failed: ${err}`); }
        await this.refresh(ev.action);
    }

    private async refresh(action: any) {
        try {
            if (!action.isKey || !action.isKey()) return;
            const s = this.settings;
            const state = readState();

            let image: string;
            const off = disconnectedIcon(state, s.offlineColor ?? "#3D3D3D", s.noDongleColor ?? "#5A1A1A");
            if (off) {
                image = off;
            } else {
                const mode = currentMode();
                const colors: Record<AncMode, string> = {
                    off: "#555555",
                    anc: s.ancColor ?? "#2E86C1",
                    ambient: s.ambientColor ?? "#8E44AD",
                };
                image = svgIcon(colors[mode], LABELS[mode]);
            }

            if (image === this.lastImage) return; // nichts geaendert
            this.lastImage = image;
            await action.setImage(image);
        } catch { /* nie werfen */ }
    }
}