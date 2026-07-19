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

const CHAT_COLOR_DEFAULT = "#2244DD";
const GAME_COLOR_DEFAULT = "#AA00AA";

interface DialSettings {
    showHeader?: boolean;
    headerText?: string;
    lowThreshold?: number;
    highThreshold?: number;
    lowColor?: string;
    midColor?: string;
    highColor?: string;
    chatColor?: string;
    gameColor?: string;
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
    const header = s.showHeader === false ? "" : (s.headerText || "JBL");
    const headerElem = header
        ? `<text x="5" y="20" text-anchor="start" font-family="sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF">${header}</text>`
        : "";
    const game = 100 - chat;
    // Bei Offline/No Dongle: Batteriewert unbekannt -> "???" in Weiss
    const batValue = statusText ? "???" : (battery == null ? "--" : `${battery}%`);
    const batClr = statusText ? "#FFFFFF" : batColor(battery, s);
    // Hintergrund: normal transparent. OFFLINE: transparent, Farbe nur im
    // Status-Text. NO DONGLE: Farbe als Hintergrund, Text weiss.
    const isNoDongle = statusText === "NO DONGLE";
    const bg = isNoDongle ? statusBg : "none";
    const statusTextColor = isNoDongle ? "#FFFFFF" : statusBg;

    let body: string;
    if (statusText) {
        // Statt Balken + Prozentwerten: Status-Text, passend gross
        body = `<text x="100" y="66" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="bold" fill="${statusTextColor}">${statusText}</text>`;
    } else {
        // Balken in exakt den ATK-Massen: Rahmen 182x10 bei x=9/y=76,
        // Spur 180x8, Fuellung 8 hoch mit rx=4.
        const chatW = Math.round(180 * (chat / 100));
        const chatColor = s.chatColor ?? CHAT_COLOR_DEFAULT;
        const gameColor = s.gameColor ?? GAME_COLOR_DEFAULT;

        body = `
<g transform="translate(14, 26)" stroke="#FFFFFF" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 4 20 v -4 a 13 13 0 0 1 26 0 v 4"/>
        <rect x="0" y="18" width="8" height="13" rx="3" fill="#FFFFFF" stroke="none"/>
        <rect x="26" y="18" width="8" height="13" rx="3" fill="#FFFFFF" stroke="none"/>
        <path d="M 26 31 v 3 a 6 6 0 0 1 -6 6 h -4" stroke-width="2.2"/>
        </g>
        <text x="60" y="58" text-anchor="start" font-family="sans-serif" font-size="23" font-weight="bold" fill="${chatColor}">${chat}<tspan font-size="11" font-weight="600" fill="#BBBBBB"> chat</tspan></text>
        <text x="192" y="58" text-anchor="end" font-family="sans-serif" font-size="23" font-weight="bold" fill="${gameColor}"><tspan font-size="11" font-weight="600" fill="#BBBBBB">game </tspan>${game}</text>
        <rect x="9" y="76" width="182" height="10" rx="5" ry="5" fill="none" stroke="#FFFFFF" stroke-width="1"/>
        <rect x="10" y="77" width="180" height="8" fill="#333333" rx="4" ry="4"/>
        <rect x="10" y="77" width="${chatW}" height="8" fill="${chatColor}" rx="4" ry="4"/>
        <rect x="${10 + chatW}" y="77" width="${180 - chatW}" height="8" fill="${gameColor}" rx="4" ry="4"/>`;
    }

    return `<svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="100" fill="${bg}"/>
      ${headerElem}
      <text x="195" y="20" text-anchor="end" font-family="sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF">BAT(<tspan fill="${batClr}">${batValue}</tspan>)</text>
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
                    statusBg = s.offlineColor ?? "#808080";
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