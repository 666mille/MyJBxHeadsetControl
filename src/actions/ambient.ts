// src/actions/ambient.ts
import streamDeck, { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, SingletonAction, KeyAction } from "@elgato/streamdeck";
import { setAmbientAware, syncAncState } from "../jbl-usb";
import { readState } from "../state";
import { svgIcon } from "../icons";

@action({ UUID: "com.holgermilz.myjbxheadsetcontrol.ambient" })
export class AmbientAction extends SingletonAction {
    private intervals = new Map<string, NodeJS.Timeout>(); // per action instance

    override async onWillAppear(ev: WillAppearEvent) {
        // Typsicherheit für das Display
        if (ev.action.isKey()) {
            await this.refresh(ev.action);
        }
        
        const old = this.intervals.get(ev.action.id);
        if (old) clearInterval(old);
        this.intervals.set(ev.action.id, setInterval(async () => {
            try {
                if (ev.action.isKey()) {
                    await this.refresh(ev.action); // Hier passiert vermutlich der USB-Zugriff
                }
            } catch (err) {
                // Der Fehler wird abgefangen! Das Plugin stürzt NICHT mehr ab (Exit 1 ist Geschichte).
                console.error("Fehler im Hintergrund-Intervall:", err);
            }
        }, 2000));
    }

    override async onWillDisappear(ev: WillDisappearEvent) {
        const t = this.intervals.get(ev.action.id);
        if (t) clearInterval(t);
        this.intervals.delete(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent) {
        try {
            if (readState().connected) {
                await syncAncState(); // real state, in case an event was missed
                if (!(await setAmbientAware(!readState().ambient_aware))) await ev.action.showAlert();
            }
        } catch (err) {
            streamDeck.logger.error(`setAmbientAware failed: ${err}`);
        }
        if (ev.action.isKey()) {
            await this.refresh(ev.action);
        }
    }

    // Explizite Typisierung als KeyAction
    private async refresh(action: KeyAction) {
        const on = !!readState().ambient_aware;
        await action.setImage(svgIcon(on ? "#8E44AD" : "#555555", on ? "AMBIENT" : "AMB OFF"));
    }
}