// src/actions/footstep.ts
// Key: toggles the Footstep Booster and shows its state and the selected game.
// Optional fixed game (property inspector): a press switches to that game and turns
// the booster on; pressed again while that game is active, it turns the booster off.
// Talks to the QuantumENGINE service (footstep.ts), not to the headset.
import streamDeck, {
    action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent,
    SingletonAction,
} from "@elgato/streamdeck";
import { readState, onStateChange } from "../state";
import { svgIcon, disconnectedIcon } from "../icons";
import {
    acquireFootstep, releaseFootstep, refreshFootstep, setFootstepEnabled, setFootstepGame, gameDisplayName,
    answerGameList,
} from "../footstep";

type FootstepSettings = {
    game?: string;
    showHeader?: boolean;
    headerText?: string;
    showGame?: boolean;
    onColor?: string;
    offColor?: string;
    unavailableColor?: string;
    offlineColor?: string;
    noDongleColor?: string;
    [key: string]: any;
};

function shorten(s: string, max = 14): string {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.footstep" })
export class FootstepAction extends SingletonAction<FootstepSettings> {
    private unsubs = new Map<string, () => void>();
    private settings = new Map<string, FootstepSettings>();
    private lastImage = new Map<string, string>();

    override async onWillAppear(ev: WillAppearEvent<FootstepSettings>) {
        this.settings.set(ev.action.id, ev.payload.settings ?? {});
        acquireFootstep();
        this.unsubs.set(ev.action.id, onStateChange(() => { this.refresh(ev.action); }));
        await this.refresh(ev.action);
    }

    override async onWillDisappear(ev: WillDisappearEvent<FootstepSettings>) {
        this.unsubs.get(ev.action.id)?.();
        this.unsubs.delete(ev.action.id);
        this.settings.delete(ev.action.id);
        this.lastImage.delete(ev.action.id);
        releaseFootstep();
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<FootstepSettings>) {
        this.settings.set(ev.action.id, ev.payload.settings ?? {});
        this.lastImage.delete(ev.action.id);
        await this.refresh(ev.action);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<any, FootstepSettings>) {
        if ((ev.payload as any)?.event === "getGames") await answerGameList();
    }

    override async onKeyDown(ev: KeyDownEvent<FootstepSettings>) {
        const state = readState();
        if (!state.connected) return;
        try {
            if (state.qe_available !== true) await refreshFootstep(); // first press after a failure: retry now
            if (readState().qe_available !== true) { await ev.action.showAlert(); return; }
            const game = ev.payload.settings.game;
            let ok = true;
            if (game) {
                const st = readState();
                if (st.footstep_enabled && st.footstep_game === game) {
                    ok = await setFootstepEnabled(false);
                } else {
                    if (st.footstep_game !== game) ok = await setFootstepGame(game);
                    if (ok && !readState().footstep_enabled) ok = await setFootstepEnabled(true);
                }
            } else {
                ok = await setFootstepEnabled(!readState().footstep_enabled);
            }
            if (!ok) await ev.action.showAlert();
        } catch (err) {
            streamDeck.logger.error(`Footstep toggle failed: ${err}`);
            await ev.action.showAlert();
        }
    }

    private async refresh(a: any) {
        try {
            if (!a.isKey?.()) return;
            const s = this.settings.get(a.id) ?? {};
            const state = readState();
            const header = (s.showHeader ?? true) ? (s.headerText || "JBL") : "";

            let image = disconnectedIcon(state, s.offlineColor ?? "#808080", s.noDongleColor ?? "#5A1A1A", header);
            if (!image) {
                if (state.qe_available === false) {
                    image = svgIcon(s.unavailableColor ?? "#6B4E16", "NO\nQUANTUM\nENGINE", "#ffffff", header);
                } else if (state.footstep_enabled === undefined) {
                    image = svgIcon(s.offColor ?? "#3D3D3D", "FOOTSTEP\n...", "#ffffff", header);
                } else if (s.game) {
                    // fixed game: highlighted only while exactly this game is boosted
                    const active = state.footstep_enabled && state.footstep_game === s.game;
                    const name = shorten(gameDisplayName(s.game));
                    image = svgIcon(active ? (s.onColor ?? "#1E8B3C") : (s.offColor ?? "#3D3D3D"),
                        `FOOTSTEP\n${name}\n${active ? "ON" : "OFF"}`, "#ffffff", header);
                } else if (state.footstep_enabled) {
                    const game = (s.showGame ?? true) ? gameDisplayName(state.footstep_game) : "";
                    image = svgIcon(s.onColor ?? "#1E8B3C", "FOOTSTEP\nON" + (game ? "\n" + shorten(game) : ""), "#ffffff", header);
                } else {
                    image = svgIcon(s.offColor ?? "#3D3D3D", "FOOTSTEP\nOFF", "#ffffff", header);
                }
            }

            if (image === this.lastImage.get(a.id)) return;
            this.lastImage.set(a.id, image);
            await a.setImage(image);
        } catch { /* never throw */ }
    }
}
