// src/actions/footstep-dial.ts
// Dial for the Footstep Booster (full_display pixmap, same style as the EQ dial):
//   rotate             choose the game (sent when the dial rests)
//   rotate while held  strength in 5 % steps
//   press / tap        booster on/off (not when the dial was turned while held)
// Talks to the QuantumENGINE service (footstep.ts), not to the headset.
import streamDeck, {
    action, DialRotateEvent, DialDownEvent, DialUpEvent, TouchTapEvent, WillAppearEvent, WillDisappearEvent,
    DidReceiveSettingsEvent, SingletonAction,
} from "@elgato/streamdeck";
import { onStateChange, readState } from "../state";
import {
    acquireFootstep, releaseFootstep, refreshFootstep, setFootstepEnabled, setFootstepGame, setFootstepPercent,
    gameDisplayName, FootstepGame,
} from "../footstep";

const SEND_DELAY_MS = 500;
const PERCENT_STEP = 5;

type FootstepDialSettings = {
    showHeader?: boolean;
    headerText?: string;
    onColor?: string;
    offColor?: string;
    pendingColor?: string;
    unavailableColor?: string;
    offlineColor?: string;
    noDongleColor?: string;
    [key: string]: any;
};

interface DialState {
    game?: string;          // shown game (pending while turning)
    percent?: number;       // shown strength (pending while turning)
    pressed: boolean;
    turnedWhilePressed: boolean;
    gameTimer?: NodeJS.Timeout;
    percentTimer?: NodeJS.Timeout;
}

function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 1-2 lines, largest font size that fits the area (same approach as the EQ dial)
function fitName(name: string, width: number, height: number): { lines: string[]; size: number } {
    const CHAR = 0.66;
    const fit = (lines: string[]) => {
        const longest = Math.max(...lines.map((l) => l.length), 1);
        return Math.min(width / (CHAR * longest), height / (lines.length * 1.15), 26);
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

function genSvg(s: FootstepDialSettings, view: {
    status: string | null; statusColor: string; statusFill: boolean;
    on: boolean; pending: boolean; game: string; percent: number;
}): string {
    const header = s.showHeader === false ? "" : (s.headerText || "JBL");
    const headerElem = header
        ? `<text x="5" y="20" font-family="sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF">${esc(header)}</text>`
        : "";
    const onColor = s.onColor ?? "#27AE60";
    const offColor = s.offColor ?? "#808080";
    const pendingColor = s.pendingColor ?? "#FF9800";

    let top: string;
    let body: string;
    if (view.status) {
        top = `<tspan fill="#FFFFFF">???</tspan>`;
        const lines = view.status.split("\n");
        // same size and position as the other dials (eq-dial.ts: 26 px at y=66)
        body = lines.map((l, i) =>
            `<text x="100" y="${(lines.length > 1 ? 54 : 66) + i * 28}" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="bold" fill="${view.statusFill ? "#FFFFFF" : view.statusColor}">${esc(l)}</text>`).join("");
    } else {
        top = view.on ? `<tspan fill="${onColor}">ON</tspan>` : `<tspan fill="${offColor}">OFF</tspan>`;
        const AREA_X = 46, AREA_W = 148, AREA_TOP = 28, AREA_H = 50;
        const { lines, size } = fitName(view.game, AREA_W, AREA_H);
        const lineH = Math.round(size * 1.15);
        const firstY = Math.round(AREA_TOP + AREA_H / 2 - (lineH * lines.length) / 2 + size * 0.85);
        const nameColor = view.pending ? pendingColor : "#FFFFFF";
        const nameElems = lines.map((l, i) =>
            `<text x="${AREA_X + AREA_W / 2}" y="${firstY + i * lineH}" text-anchor="middle" font-family="sans-serif" font-size="${size}" font-weight="bold" fill="${nameColor}">${esc(l)}</text>`).join("");
        const barW = Math.round(140 * Math.max(0, Math.min(100, view.percent)) / 100);
        const barColor = view.on ? onColor : offColor;
        body = `
      <g fill="#FFFFFF">
        <ellipse cx="15" cy="44" rx="6" ry="9"/><ellipse cx="15" cy="60" rx="4.5" ry="5"/>
        <ellipse cx="30" cy="36" rx="6" ry="9"/><ellipse cx="30" cy="52" rx="4.5" ry="5"/>
      </g>
      ${nameElems}
      <rect x="46" y="84" width="140" height="8" rx="4" fill="#3D3D3D"/>
      <rect x="46" y="84" width="${barW}" height="8" rx="4" fill="${barColor}"/>
      <text x="8" y="93" font-family="sans-serif" font-size="12" font-weight="bold" fill="#FFFFFF">${view.percent}%</text>`;
    }

    const bg = view.status && view.statusFill ? view.statusColor : "none";
    return `<svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="100" fill="${bg}"/>
      ${headerElem}
      <text x="195" y="20" text-anchor="end" font-family="sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF">STEPS(${top})</text>
      ${body}
    </svg>`;
}

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.footstepdial" })
export class FootstepDialAction extends SingletonAction<FootstepDialSettings> {
    private settings = new Map<string, FootstepDialSettings>();
    private dials = new Map<string, DialState>();
    private unsubs = new Map<string, () => void>();
    private lastSvg = new Map<string, string>();

    private dial(id: string): DialState {
        let d = this.dials.get(id);
        if (!d) { d = { pressed: false, turnedWhilePressed: false }; this.dials.set(id, d); }
        return d;
    }

    override async onWillAppear(ev: WillAppearEvent<FootstepDialSettings>) {
        this.settings.set(ev.action.id, ev.payload.settings ?? {});
        acquireFootstep();
        this.unsubs.set(ev.action.id, onStateChange(() => { this.refresh(ev.action); }));
        await this.refresh(ev.action);
    }

    override async onWillDisappear(ev: WillDisappearEvent<FootstepDialSettings>) {
        this.unsubs.get(ev.action.id)?.();
        this.unsubs.delete(ev.action.id);
        const d = this.dials.get(ev.action.id);
        if (d?.gameTimer) clearTimeout(d.gameTimer);
        if (d?.percentTimer) clearTimeout(d.percentTimer);
        this.dials.delete(ev.action.id);
        this.settings.delete(ev.action.id);
        this.lastSvg.delete(ev.action.id);
        releaseFootstep();
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<FootstepDialSettings>) {
        this.settings.set(ev.action.id, ev.payload.settings ?? {});
        this.lastSvg.delete(ev.action.id);
        await this.refresh(ev.action);
    }

    private usable(): boolean {
        const st = readState();
        return st.connected === true && st.qe_available === true;
    }

    override async onDialRotate(ev: DialRotateEvent<FootstepDialSettings>) {
        if (!this.usable()) return;
        const d = this.dial(ev.action.id);
        const st = readState();
        if (ev.payload.pressed) {
            d.turnedWhilePressed = true;
            const cur = d.percent ?? st.footstep_percent ?? 100;
            d.percent = Math.max(0, Math.min(100, cur + ev.payload.ticks * PERCENT_STEP));
            if (d.percentTimer) clearTimeout(d.percentTimer);
            d.percentTimer = setTimeout(async () => {
                d.percentTimer = undefined;
                const p = d.percent!;
                if (!(await setFootstepPercent(p))) await ev.action.showAlert();
                d.percent = undefined;
                this.refresh(ev.action);
            }, SEND_DELAY_MS);
        } else {
            const games: FootstepGame[] = st.footstep_games ?? [];
            if (!games.length) return;
            const names = games.map((g) => g.name);
            let idx = Math.max(0, names.indexOf(d.game ?? st.footstep_game ?? ""));
            idx = ((idx + ev.payload.ticks) % names.length + names.length) % names.length;
            d.game = names[idx];
            if (d.gameTimer) clearTimeout(d.gameTimer);
            d.gameTimer = setTimeout(async () => {
                d.gameTimer = undefined;
                const g = d.game!;
                if (!(await setFootstepGame(g))) await ev.action.showAlert();
                d.game = undefined;
                this.refresh(ev.action);
            }, SEND_DELAY_MS);
        }
        await this.refresh(ev.action);
    }

    override async onDialDown(ev: DialDownEvent<FootstepDialSettings>) {
        const d = this.dial(ev.action.id);
        d.pressed = true;
        d.turnedWhilePressed = false;
    }

    override async onDialUp(ev: DialUpEvent<FootstepDialSettings>) {
        const d = this.dial(ev.action.id);
        const toggle = d.pressed && !d.turnedWhilePressed;
        d.pressed = false;
        d.turnedWhilePressed = false;
        if (toggle) await this.toggle(ev.action);
    }

    override async onTouchTap(ev: TouchTapEvent<FootstepDialSettings>) {
        await this.toggle(ev.action);
    }

    private async toggle(a: any) {
        if (!readState().connected) return;
        try {
            if (readState().qe_available !== true) await refreshFootstep();
            if (readState().qe_available !== true) { await a.showAlert(); return; }
            if (!(await setFootstepEnabled(!readState().footstep_enabled))) await a.showAlert();
        } catch (err) {
            streamDeck.logger.error(`Footstep toggle failed: ${err}`);
            await a.showAlert();
        }
        await this.refresh(a);
    }

    private async refresh(a: any) {
        try {
            if (!a.isDial?.()) return;
            const st = readState();
            const s = this.settings.get(a.id) ?? {};
            const d = this.dial(a.id);

            let status: string | null = null;
            let statusColor = "#808080";
            let statusFill = false;
            if (!st.connected) {
                if (st.dongle_present === false) {
                    status = "NO DONGLE"; statusColor = s.noDongleColor ?? "#5A1A1A"; statusFill = true;
                } else {
                    status = "OFFLINE"; statusColor = s.offlineColor ?? "#808080";
                }
            } else if (st.qe_available === false) {
                status = "NO QUANTUM\nENGINE"; statusColor = s.unavailableColor ?? "#6B4E16"; statusFill = true;
            }

            const pending = d.game !== undefined && d.game !== st.footstep_game;
            const game = gameDisplayName(d.game ?? st.footstep_game) || "...";
            const percent = d.percent ?? st.footstep_percent ?? 0;
            const svg = genSvg(s, { status, statusColor, statusFill, on: !!st.footstep_enabled, pending, game, percent });
            if (svg === this.lastSvg.get(a.id)) return;
            this.lastSvg.set(a.id, svg);
            await a.setFeedback({ full_display: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, title: "", value: "" });
        } catch { /* never throw */ }
    }
}
