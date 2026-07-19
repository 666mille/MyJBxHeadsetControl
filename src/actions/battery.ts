// src/actions/battery.ts
// refresh() ruft NIE getSettings() -- Settings werden gecacht
// (getSettings -> didReceiveSettings -> refresh waere eine Endlosschleife).
import streamDeck, {
    action, WillAppearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction,
} from "@elgato/streamdeck";
import { readState, onStateChange } from "../state";
import { batteryIcon, disconnectedIcon } from "../icons";

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.battery" })
export class BatteryAction extends SingletonAction {
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

    override async onPropertyInspectorDidAppear(ev: any) {
        await this.pushStatusToPI(ev.action);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<any, any>) {
        if (ev.payload && (ev.payload as any).event === "getStatus") {
            await this.pushStatusToPI(ev.action);
        }
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
            } else if (state.battery == null) {
                image = batteryIcon(null, "#808080", s.background ?? "#1A1A1A", hdr);
            } else {
                const low = s.lowThreshold ?? 20;
                const high = s.highThreshold ?? 80;
                const battery = state.battery;
                let color: string;
                if (battery < low) color = s.lowColor ?? "#C0392B";
                else if (battery > high) color = s.highColor ?? "#27AE60";
                else color = s.midColor ?? "#F1C40F";
                image = batteryIcon(battery, color, s.background ?? "#1A1A1A", hdr);
            }

            if (image === this.lastImage) return;
            this.lastImage = image;
            await action.setImage(image);
            await this.pushStatusToPI(action);
        } catch { /* nie werfen */ }
    }

    private async pushStatusToPI(action: any) {
        const state = readState();
        try {
            await action.sendToPropertyInspector({
                connected: !!state.connected,
                battery: state.battery ?? null,
            });
        } catch { /* PI evtl. nicht offen */ }
    }
}