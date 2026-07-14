// src/actions/chat-balance.ts
// Dial-Display (full_display-Pixmap via Custom-Layout):
//   oben:   JBL (links) | BAT(xx) rechts, Farbe nach Batterie-Schwellen
//   mitte:  Prozentwerte + zweifarbiger Balken (Chat blau / Game lila)
//   unten:  GAME-CHAT-BALANCE
// Letzter Wert wird in den Settings gespeichert (Anzeige nach Neustart).
import streamDeck, {
    action, DialRotateEvent, DialDownEvent, WillAppearEvent, DidReceiveSettingsEvent, SingletonAction,
} from "@elgato/streamdeck";
import { setChatBalance } from "../jbl-usb";
import { readState, onStateChange } from "../state";

const CHAT_COLOR = "#2244DD";
const GAME_COLOR = "#AA00AA";

interface DialSettings {
    lowThreshold?: number;
    highThreshold?: number;
    lowColor?: string;
    midColor?: string;
    highColor?: string;
    offlineColor?: string;
    noDongleColor?: string;
    [key: string]: any;
}

function batColor(battery: number | null, s: DialSettings): string {
    if (battery == null) return "#888888";
    const low = s.lowThreshold ?? 20;
    const high = s.highThreshold ?? 80;
    if (battery < low) return s.lowColor ?? "#C0392B";
    if (battery > high) return s.highColor ?? "#27AE60";
    return s.midColor ?? "#F1C40F";
}

function genSvg(chat: number, battery: number | null, s: DialSettings, statusText: string | null, statusBg: string): string {
    const game = 100 - chat;
    // Bei Offline/No Dongle: Batteriewert unbekannt -> "???" in Weiss
    const batValue = statusText ? "???" : (battery == null ? "--" : `${battery}%`);
    const batClr = statusText ? "#FFFFFF" : batColor(battery, s);
    // Hintergrund: normal dunkel, im Statusfall die Offline-/NoDongle-Farbe
    const bg = statusText ? statusBg : "#1A1A1A";

    let body: string;
    if (statusText) {
        // Statt Balken + Prozentwerten: Status-Text in Weiss, passend gross
        body = `<text x="100" y="66" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="bold" fill="#FFFFFF">${statusText}</text>`;
    } else {
        const maxW = 176;
        const x0 = 12;
        const barH = 20;
        const barY = 48;
        const chatW = Math.round(maxW * (chat / 100));
        const knobX = x0 + chatW;

        const bubble = chatW > 30 ? `
        <rect x="${x0 + 7}" y="${barY + 5}" width="13" height="9" rx="2.5" fill="#FFFFFF"/>
        <path d="M ${x0 + 10} ${barY + 14} L ${x0 + 10} ${barY + 17} L ${x0 + 14} ${barY + 14} Z" fill="#FFFFFF"/>` : "";

        const pad = (maxW - chatW) > 32 ? `
        <rect x="${x0 + maxW - 24}" y="${barY + 6}" width="17" height="8" rx="4" fill="#FFFFFF"/>
        <circle cx="${x0 + maxW - 20}" cy="${barY + 10}" r="1.7" fill="${GAME_COLOR}"/>
        <circle cx="${x0 + maxW - 11}" cy="${barY + 10}" r="1.7" fill="${GAME_COLOR}"/>` : "";

        body = `
        <text x="${x0}" y="42" text-anchor="start" font-family="sans-serif" font-size="19" font-weight="bold" fill="#FFFFFF">${chat}</text>
        <text x="${x0 + maxW}" y="42" text-anchor="end" font-family="sans-serif" font-size="19" font-weight="bold" fill="#FFFFFF">${game}</text>
        <rect x="${x0}" y="${barY}" width="${chatW}" height="${barH}" rx="7" fill="${CHAT_COLOR}"/>
        <rect x="${knobX}" y="${barY}" width="${maxW - chatW}" height="${barH}" rx="7" fill="${GAME_COLOR}"/>
        <rect x="${knobX - 2}" y="${barY - 3}" width="4" height="${barH + 6}" rx="2" fill="#EEEEEE"/>
        ${bubble}
        ${pad}`;
    }

    return `<svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="100" fill="${bg}"/>
      <text x="12" y="17" text-anchor="start" font-family="sans-serif" font-size="13" font-weight="bold" fill="#FFFFFF">JBL</text>
      <text x="188" y="17" text-anchor="end" font-family="sans-serif" font-size="13" font-weight="bold" fill="#FFFFFF">BAT(<tspan fill="${batClr}">${batValue}</tspan>)</text>
      <text x="100" y="95" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="600" fill="#BBBBBB">GAME-CHAT-BALANCE</text>
      ${body}
    </svg>`;
}

const RENDER_THROTTLE_MS = 100;

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.chatbalance" })
export class ChatBalanceAction extends SingletonAction {
    private interval?: NodeJS.Timeout;
    private unsub?: () => void;
    private settings: DialSettings = {};
    private lastSvg = "";
    private lastRenderAt = 0;
    private trailingTimer?: NodeJS.Timeout;

    override async onWillAppear(ev: WillAppearEvent) {
        try { this.settings = ((await ev.action.getSettings()) ?? {}) as DialSettings; } catch { this.settings = {}; }
        await this.refresh(ev.action);
        this.unsub = onStateChange(() => { this.refresh(ev.action); });
        this.interval = setInterval(() => { this.refresh(ev.action); }, 5000);
    }

    override async onWillDisappear() {
        if (this.interval) clearInterval(this.interval);
        if (this.unsub) this.unsub();
        if (this.trailingTimer) clearTimeout(this.trailingTimer);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent) {
        this.settings = ((ev.payload?.settings as DialSettings) ?? {});
        this.lastSvg = ""; // Neuzeichnen erzwingen
        await this.refresh(ev.action);
    }

    override async onDialRotate(ev: DialRotateEvent) {
        try {
            if (!readState().connected) return;
            const current = this.currentBalance();
            const next = Math.max(0, Math.min(100, current + ev.payload.ticks));
            setChatBalance(next);
            this.settings = { ...this.settings, lastBalance: next };
            await ev.action.setSettings(this.settings);
        } catch (err) { streamDeck.logger.error(`setChatBalance failed: ${err}`); }
        await this.refresh(ev.action);
    }

    override async onDialDown(ev: DialDownEvent) {
        try {
            if (!readState().connected) return;
            setChatBalance(50);
            this.settings = { ...this.settings, lastBalance: 50 };
            await ev.action.setSettings(this.settings);
        } catch (err) { streamDeck.logger.error(`setChatBalance (reset) failed: ${err}`); }
        await this.refresh(ev.action);
    }

    private currentBalance(): number {
        const stateVal = readState().chat_balance;
        if (typeof stateVal === "number") return stateVal;
        if (typeof this.settings.lastBalance === "number") return this.settings.lastBalance;
        return 50;
    }

    private async refresh(action: any) {
        try {
            if (!action.isDial || !action.isDial()) return;
            const state = readState();
            const s = this.settings;

            let statusText: string | null = null;
            let statusBg = "#3D3D3D";
            if (!state.connected) {
                if (state.dongle_present === false) {
                    statusText = "NO DONGLE";
                    statusBg = s.noDongleColor ?? "#5A1A1A";
                } else {
                    statusText = "OFFLINE";
                    statusBg = s.offlineColor ?? "#3D3D3D";
                }
            }

            const chat = this.currentBalance();
            const battery = typeof state.battery === "number" ? state.battery : null;
            const svg = genSvg(chat, battery, s, statusText, statusBg);

            // Nichts geaendert -> nichts senden
            if (svg === this.lastSvg) return;

            // Throttle: waehrend schneller Event-Folgen (Rad am Headset)
            // hoechstens alle RENDER_THROTTLE_MS ein Frame; der letzte
            // Stand wird ueber den Trailing-Timer garantiert gezeichnet.
            const now = Date.now();
            const elapsed = now - this.lastRenderAt;
            if (elapsed < RENDER_THROTTLE_MS) {
                if (!this.trailingTimer) {
                    this.trailingTimer = setTimeout(() => {
                        this.trailingTimer = undefined;
                        this.refresh(action);
                    }, RENDER_THROTTLE_MS - elapsed + 5);
                }
                return;
            }

            this.lastRenderAt = now;
            this.lastSvg = svg;
            const b64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
            await action.setFeedback({ full_display: b64, title: "", value: "" });
        } catch { /* nie werfen */ }
    }
}