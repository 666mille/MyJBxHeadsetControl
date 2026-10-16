// src/eq-common.ts
// Shared helpers for the EQ key and dial.
import streamDeck from "@elgato/streamdeck";
import { initEngine, engineStatus, readPresets } from "./eq-engine";
import { readState } from "./state";

type GlobalSettings = { dllPath?: string };
let initialized = false;

export async function ensureEngine(): Promise<void> {
    if (initialized && engineStatus().ok) return;
    const g = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
    const r = initEngine(g.dllPath);
    initialized = true;
    if (r.ok) streamDeck.logger.info(`EQ engine ready (${r.dll})`);
    else streamDeck.logger.error(`EQ engine not ready: ${r.error} (${r.dll ?? "no DLL"})`);
}

// DLL path changed in the property inspector
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>(ev => {
    initialized = false;
    initEngine(ev.settings.dllPath);
});

export function presetNames(): string[] {
    try { return readPresets().presets.map(p => p.name); } catch { return []; }
}

// Last preset sent by the plugin, otherwise the one from q950.dat
export function activePreset(): string | null {
    const s = readState();
    if (s.eq_preset) return s.eq_preset;
    try { return readPresets().current; } catch { return null; }
}

// Answer for the preset dropdown (sdpi datasource). Inits the engine itself,
// since onWillAppear doesn't fire without a connected Stream Deck.
export async function answerPresetList(): Promise<void> {
    let items: { label: string; value: string; disabled?: boolean }[] = [];
    let datError = "";
    try {
        await ensureEngine();
    } catch (err) {
        streamDeck.logger.error(`EQ engine error: ${err}`);
    }
    try {
        items = readPresets().presets.map(p => ({ label: p.name, value: p.name }));
    } catch (err) {
        datError = `cannot read q950.dat: ${err}`;
        streamDeck.logger.error(datError);
    }
    if (!items.length) items = [{ label: "No presets found", value: "", disabled: true }];
    const status = engineStatus();
    await streamDeck.ui.sendToPropertyInspector({ event: "getPresets", items });
    await streamDeck.ui.sendToPropertyInspector({
        event: "engineStatus",
        ok: status.ok && !datError,
        error: datError || status.error || "not initialized",
    });
}
