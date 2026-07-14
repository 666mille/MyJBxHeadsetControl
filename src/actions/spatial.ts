// src/actions/spatial.ts
// refresh() ruft NIE getSettings() -- Settings werden gecacht
// (getSettings -> didReceiveSettings -> refresh waere eine Endlosschleife).
import streamDeck, { action, KeyDownEvent, WillAppearEvent, DidReceiveSettingsEvent, SingletonAction } from "@elgato/streamdeck";
import { setSpatialSound } from "../jbl-usb";
import { readState, onStateChange } from "../state";
import { svgIcon, disconnectedIcon } from "../icons";

type SpatialMode = "off" | "fixed" | "headtracking";
const MODES: SpatialMode[] = ["off", "fixed", "headtracking"];
const LABELS: Record<SpatialMode, string> = {
    off: "SPATIAL\nOFF",
    fixed: "SPATIAL\nFIXED",
    headtracking: "HEAD\nTRACKING",
};

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.spatial" })
export class SpatialAction extends SingletonAction {
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
                const cur: SpatialMode = readState().spatial_sound ?? "off";
                setSpatialSound(MODES[(MODES.indexOf(cur) + 1) % MODES.length]);
            }
        } catch (err) { streamDeck.logger.error(`setSpatialSound failed: ${err}`); }
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
                const mode: SpatialMode = state.spatial_sound ?? "off";
                const colors: Record<SpatialMode, string> = {
                    off: "#555555",
                    fixed: s.fixedColor ?? "#D68910",
                    headtracking: s.headtrackingColor ?? "#D4AC0D",
                };
                image = svgIcon(colors[mode], LABELS[mode]);
            }

            if (image === this.lastImage) return;
            this.lastImage = image;
            await action.setImage(image);
        } catch { /* nie werfen */ }
    }
}