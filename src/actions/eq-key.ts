// src/actions/eq-key.ts
// Key: applies the preset chosen in the property inspector.
import streamDeck, {
    action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent,
    SendToPluginEvent, SingletonAction,
} from "@elgato/streamdeck";
import { applyEqPreset } from "../jbl-usb";
import { onStateChange, readState } from "../state";
import { svgIcon, disconnectedIcon } from "../icons";
import { ensureEngine, activePreset, answerPresetList } from "../eq-common";

type EqKeySettings = {
    preset?: string;
    showHeader?: boolean;
    headerText?: string;
    activeColor?: string;
    inactiveColor?: string;
    offlineColor?: string;
    noDongleColor?: string;
    applyOnSelect?: boolean;
    [key: string]: any;
};

// Wrap long preset names on spaces, max. 3 lines
function wrapName(name: string, maxLen = 10): string {
    const words = name.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
        if (cur && (cur + " " + w).length > maxLen) { lines.push(cur); cur = w; }
        else cur = cur ? cur + " " + w : w;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3).join("\n");
}

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.eqkey" })
export class EqKeyAction extends SingletonAction<EqKeySettings> {
    private unsubs = new Map<string, () => void>();
    private settings = new Map<string, EqKeySettings>();

    override async onWillAppear(ev: WillAppearEvent<EqKeySettings>) {
        await ensureEngine();
        this.settings.set(ev.action.id, ev.payload.settings);
        await this.refresh(ev.action);
        this.unsubs.set(ev.action.id, onStateChange(() => { this.refresh(ev.action); }));
    }

    override async onWillDisappear(ev: WillDisappearEvent<EqKeySettings>) {
        this.unsubs.get(ev.action.id)?.();
        this.unsubs.delete(ev.action.id);
        this.settings.delete(ev.action.id);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<EqKeySettings>) {
        const before = this.settings.get(ev.action.id)?.preset;
        const s = ev.payload.settings;
        this.settings.set(ev.action.id, s);
        // Only send when the preset itself changed, not on color/text changes
        if (s.applyOnSelect && s.preset && s.preset !== before) {
            try {
                await ensureEngine();
                await applyEqPreset(s.preset);
                if (ev.action.isKey()) await ev.action.showOk();
            } catch (err) {
                streamDeck.logger.error(`EQ preset "${s.preset}" failed: ${err}`);
                await ev.action.showAlert();
            }
        }
        await this.refresh(ev.action);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<any, EqKeySettings>) {
        if ((ev.payload as any)?.event === "getPresets") await answerPresetList();
    }

    override async onKeyDown(ev: KeyDownEvent<EqKeySettings>) {
        const name = ev.payload.settings.preset;
        if (!name) { await ev.action.showAlert(); return; }
        try {
            await ensureEngine();
            await applyEqPreset(name);
            await ev.action.showOk();
        } catch (err) {
            streamDeck.logger.error(`EQ preset "${name}" failed: ${err}`);
            await ev.action.showAlert();
        }
    }

    private async refresh(a: any) {
        if (!a.isKey?.()) return;
        const s = this.settings.get(a.id) ?? {};
        const header = (s.showHeader ?? true) ? (s.headerText ?? "JBL") : "";

        const off = disconnectedIcon(readState(), s.offlineColor ?? "#808080", s.noDongleColor ?? "#5A1A1A", header);
        if (off) { await a.setImage(off); await a.setTitle(""); return; }

        const name = s.preset ?? "EQ ?";
        const active = !!s.preset && s.preset === activePreset();
        const color = active ? (s.activeColor ?? "#1E8B3C") : (s.inactiveColor ?? "#3D3D3D");
        await a.setImage(svgIcon(color, wrapName(name), "#ffffff", header));
        await a.setTitle("");
    }
}
