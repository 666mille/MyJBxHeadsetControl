// src/actions/spatial.ts
// refresh() ruft NIE getSettings() -- Settings werden gecacht
// (getSettings -> didReceiveSettings -> refresh waere eine Endlosschleife).
import streamDeck, { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SingletonAction } from "@elgato/streamdeck";
import { setSpatialSound, syncSpatialState } from "../jbl-usb";
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
                await syncSpatialState(); // real state, in case an event was missed
                const cur: SpatialMode = readState().spatial_sound ?? "off";
                if (!(await setSpatialSound(MODES[(MODES.indexOf(cur) + 1) % MODES.length]))) await ev.action.showAlert();
            }
        } catch (err) { streamDeck.logger.error(`setSpatialSound failed: ${err}`); }
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
                const mode: SpatialMode = state.spatial_sound ?? "off";
                const colors: Record<SpatialMode, string> = {
                    off: "#555555",
                    fixed: s.fixedColor ?? "#D68910",
                    headtracking: s.headtrackingColor ?? "#D4AC0D",
                };
                image = svgIcon(colors[mode], LABELS[mode], "#ffffff", hdr);
            }

            if (image === this.lastImage) return;
            this.lastImage = image;
            await action.setImage(image);
        } catch { /* nie werfen */ }
    }
}