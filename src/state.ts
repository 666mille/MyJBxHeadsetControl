// src/state.ts
// In-Memory-State + Subscription. Der Datei-Spiegel (state.json) wird
// GEBUENDELT geschrieben (max. alle 500ms), nicht bei jedem Update:
// Das Game-Chat-Rad am Headset feuert pro Rastschritt ein Event; ein
// synchroner Plattenschreibvorgang pro Event blockiert die Event-Loop
// und laesst die Verarbeitung um Sekunden hinterherhinken.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.join(__dirname, "state.json");

let memoryState: Record<string, any> = {};

try {
    if (fs.existsSync(STATE_FILE)) {
        memoryState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
} catch {
    memoryState = {};
}

// Verbindungszustand NIE aus der Datei uebernehmen: Er muss bei jedem
// Start neu durch echte Lebenszeichen des Headsets bewiesen werden.
// Sonst zeigt das Plugin nach einem Rechnerstart mit ausgeschaltetem
// Headset faelschlich den "an"-Zustand der letzten Sitzung.
memoryState.connected = false;
delete memoryState.dongle_present;

// --- Subscription ---
type Listener = () => void;
const listeners = new Set<Listener>();
let notifyPending = false;

export function onStateChange(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify(): void {
    if (notifyPending) return;
    notifyPending = true;
    setTimeout(() => {
        notifyPending = false;
        for (const cb of listeners) {
            try { cb(); } catch { /* ignorieren */ }
        }
    }, 20);
}

// --- Gebuendelter Datei-Spiegel ---
const MIRROR_INTERVAL_MS = 500;
let mirrorTimer: NodeJS.Timeout | null = null;
let mirrorDirty = false;

function scheduleMirror(): void {
    mirrorDirty = true;
    if (mirrorTimer) return;
    mirrorTimer = setTimeout(() => {
        mirrorTimer = null;
        if (!mirrorDirty) return;
        mirrorDirty = false;
        try {
            const tmpFile = STATE_FILE + ".tmp";
            fs.writeFileSync(tmpFile, JSON.stringify(memoryState, null, 2), "utf-8");
            fs.renameSync(tmpFile, STATE_FILE);
        } catch { /* unkritisch, naechster Versuch beim naechsten Update */ }
    }, MIRROR_INTERVAL_MS);
}

export function readState(): any {
    return { ...memoryState };
}

export function updateState(key: string, value: any): void {
    if (memoryState[key] === value) return;
    memoryState[key] = value;
    notify();          // sofort (in-memory)
    scheduleMirror();  // Platte: gebuendelt, spaeter
}