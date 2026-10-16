// src/actions/eq-dial.ts
// Dial display (full_display pixmap via custom layout), same style as the chat balance dial:
//   left:  JBL header, headset icon, EQ slider icon
//   top right: EQ(active) / EQ(> press)
//   right: preset name, font size fitted to the free area
// Rotate to browse, press or tap to apply. Without a press it jumps back to the active preset.
import streamDeck, {
    action, DialRotateEvent, DialDownEvent, TouchTapEvent, WillAppearEvent, WillDisappearEvent,
    SendToPluginEvent, DidReceiveSettingsEvent, SingletonAction,
} from "@elgato/streamdeck";
import { applyEqPreset } from "../jbl-usb";
import { onStateChange, readState } from "../state";
import { ensureEngine, activePreset, presetNames, answerPresetList } from "../eq-common";

const REVERT_MS = 3000;

type EqDialSettings = {
    preset?: string;
    applyOnSelect?: boolean;
    showHeader?: boolean;
    headerText?: string;
    activeColor?: string;
    pendingColor?: string;
    offlineColor?: string;
    noDongleColor?: string;
    [key: string]: any;
};

function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Splits the name into 1-2 lines and picks the largest font size that fits the area
function fitName(name: string, width: number, height: number): { lines: string[]; size: number } {
    const CHAR = 0.66; // average bold sans-serif char width / font size, with some margin
    const fit = (lines: string[]) => {
        const longest = Math.max(...lines.map((l) => l.length), 1);
        const byWidth = width / (CHAR * longest);
        const byHeight = height / (lines.length * 1.15);
        return Math.min(byWidth, byHeight, 28);
    };
    let best = { lines: [name], size: fit([name]) };
    const words = name.split(" ");
    for (let i = 1; i < words.length; i++) {
        const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
        const size = fit(lines);
        if (size > best.size) best = { lines, size };
    }
    return { lines: best.lines, size: Math.max(9, Math.floor(best.size)) };
}

function genSvg(name: string, active: boolean, s: EqDialSettings, statusText: string | null, statusBg: string): string {
    const header = s.showHeader === false ? "" : (s.headerText || "JBL");
    const headerElem = header
        ? `<text x="5" y="20" text-anchor="start" font-family="sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF">${esc(header)}</text>`
        : "";
    const isNoDongle = statusText === "NO DONGLE";
    const bg = isNoDongle ? statusBg : "none";
    const statusTextColor = isNoDongle ? "#FFFFFF" : statusBg;

    let eqState: string;
    let body: string;
    if (statusText) {
        eqState = `<tspan fill="#FFFFFF">???</tspan>`;
        body = `<text x="100" y="66" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="bold" fill="${statusTextColor}">${statusText}</text>`;
    } else {
        eqState = active
            ? `<tspan fill="${s.activeColor ?? "#27AE60"}">active</tspan>`
            : `<tspan fill="${s.pendingColor ?? "#FF9800"}">&gt; press</tspan>`;

        // Preset name: area right of the icons, below the top line
        const AREA_X = 46, AREA_W = 148, AREA_TOP = 28, AREA_H = 68;
        const { lines, size } = fitName(name, AREA_W, AREA_H);
        const lineH = Math.round(size * 1.15);
        const firstY = Math.round(AREA_TOP + AREA_H / 2 - (lineH * lines.length) / 2 + size * 0.85);
        const nameElems = lines
            .map((l, i) => `<text x="${AREA_X + AREA_W / 2}" y="${firstY + i * lineH}" text-anchor="middle" font-family="sans-serif" font-size="${size}" font-weight="bold" fill="#FFFFFF">${esc(l)}</text>`)
            .join("\n      ");

        body = `
      <g transform="translate(9, 26) scale(0.8)" stroke="#FFFFFF" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 4 20 v -4 a 13 13 0 0 1 26 0 v 4"/>
        <rect x="0" y="18" width="8" height="13" rx="3" fill="#FFFFFF" stroke="none"/>
        <rect x="26" y="18" width="8" height="13" rx="3" fill="#FFFFFF" stroke="none"/>
        <path d="M 26 31 v 3 a 6 6 0 0 1 -6 6 h -4" stroke-width="2.2"/>
      </g>
      <g stroke="#FFFFFF" stroke-width="2" stroke-linecap="round">
        <line x1="12" y1="66" x2="12" y2="92"/>
        <line x1="22" y1="66" x2="22" y2="92"/>
        <line x1="32" y1="66" x2="32" y2="92"/>
      </g>
      <g fill="#FFFFFF">
        <circle cx="12" cy="83" r="3.6"/>
        <circle cx="22" cy="72" r="3.6"/>
        <circle cx="32" cy="80" r="3.6"/>
      </g>
      ${nameElems}`;
    }

    return `<svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="100" fill="${bg}"/>
      ${headerElem}
      <text x="195" y="20" text-anchor="end" font-family="sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF">EQ(${eqState})</text>
      ${body}
    </svg>`;
}

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.eqdial" })
export class EqDialAction extends SingletonAction<EqDialSettings> {
    private selected = new Map<string, string>();
    private settings = new Map<string, EqDialSettings>();
    private unsubs = new Map<string, () => void>();
    private revertTimers = new Map<string, NodeJS.Timeout>();
    private lastSvg = new Map<string, string>();

    override async onWillAppear(ev: WillAppearEvent<EqDialSettings>) {
        await ensureEngine();
        this.settings.set(ev.action.id, ev.payload.settings);
        const start = activePreset() ?? ev.payload.settings.preset ?? presetNames()[0];
        if (start) this.selected.set(ev.action.id, start);
        await this.refresh(ev.action);
        this.unsubs.set(ev.action.id, onStateChange(() => { this.refresh(ev.action); }));
    }

    override async onWillDisappear(ev: WillDisappearEvent<EqDialSettings>) {
        this.unsubs.get(ev.action.id)?.();
        this.unsubs.delete(ev.action.id);
        this.clearRevert(ev.action.id);
        this.lastSvg.delete(ev.action.id);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<EqDialSettings>) {
        const s = ev.payload.settings;
        const before = this.settings.get(ev.action.id)?.preset;
        this.settings.set(ev.action.id, s);
        this.lastSvg.delete(ev.action.id); // force redraw (colors may have changed)
        if (s.applyOnSelect && s.preset && s.preset !== before) {
            this.selected.set(ev.action.id, s.preset);
            await this.apply(ev.action);
            return;
        }
        await this.refresh(ev.action);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<any, EqDialSettings>) {
        if ((ev.payload as any)?.event === "getPresets") await answerPresetList();
    }

    override async onDialRotate(ev: DialRotateEvent<EqDialSettings>) {
        if (!readState().connected) return;
        const names = presetNames();
        if (!names.length) return;
        let idx = Math.max(0, names.indexOf(this.selected.get(ev.action.id) ?? ""));
        idx = ((idx + ev.payload.ticks) % names.length + names.length) % names.length;
        this.selected.set(ev.action.id, names[idx]);
        this.scheduleRevert(ev.action);
        await this.refresh(ev.action); // select only, nothing sent yet
    }

    override async onDialDown(ev: DialDownEvent<EqDialSettings>) {
        await this.apply(ev.action);
    }

    override async onTouchTap(ev: TouchTapEvent<EqDialSettings>) {
        await this.apply(ev.action);
    }

    // Without a press within REVERT_MS, go back to the active preset
    private scheduleRevert(a: any) {
        this.clearRevert(a.id);
        this.revertTimers.set(a.id, setTimeout(() => {
            this.revertTimers.delete(a.id);
            const active = activePreset();
            if (active) this.selected.set(a.id, active);
            this.refresh(a);
        }, REVERT_MS));
    }

    private clearRevert(id: string) {
        const t = this.revertTimers.get(id);
        if (t) clearTimeout(t);
        this.revertTimers.delete(id);
    }

    private async apply(a: any) {
        this.clearRevert(a.id);
        const name = this.selected.get(a.id);
        if (!name || !readState().connected) { await a.showAlert(); return; }
        try {
            await ensureEngine();
            await applyEqPreset(name);
            const s = { ...(this.settings.get(a.id) ?? {}), preset: name };
            this.settings.set(a.id, s);
            await a.setSettings(s);
        } catch (err) {
            streamDeck.logger.error(`EQ preset "${name}" failed: ${err}`);
            await a.showAlert();
            const active = activePreset();
            if (active) this.selected.set(a.id, active);
        }
        await this.refresh(a);
    }

    private async refresh(a: any) {
        try {
            if (!a.isDial?.()) return;
            const st = readState();
            const s = this.settings.get(a.id) ?? {};

            let statusText: string | null = null;
            let statusBg = "#3D3D3D";
            if (!st.connected) {
                if (st.dongle_present === false) {
                    statusText = "NO DONGLE";
                    statusBg = s.noDongleColor ?? "#5A1A1A";
                } else {
                    statusText = "OFFLINE";
                    statusBg = s.offlineColor ?? "#808080";
                }
            }

            // Not browsing -> follow the active preset (e.g. after a key press)
            if (!this.revertTimers.has(a.id)) {
                const act = activePreset();
                if (act) this.selected.set(a.id, act);
            }
            const name = this.selected.get(a.id) ?? "-";
            const svg = genSvg(name, name === activePreset(), s, statusText, statusBg);
            if (svg === this.lastSvg.get(a.id)) return;
            this.lastSvg.set(a.id, svg);
            const b64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
            await a.setFeedback({ full_display: b64, title: "", value: "" });
        } catch { /* never throw */ }
    }
}

