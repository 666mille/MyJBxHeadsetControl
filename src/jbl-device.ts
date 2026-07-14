// src/jbl-device.ts
// Zentraler HID-Zugriff: EIN gemeinsamer Handle fuer Lesen (Events) und Schreiben (Befehle).
import { HID, devices } from "node-hid";
import streamDeck from "@elgato/streamdeck";
import { updateState } from "./state";

const VID = 0x0ecb;
const PID = 0x2127;
const COL_INDEX = 3;

let device: HID | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let dataHandler: ((data: Buffer) => void) | null = null;
let connecting = false;

function devicePresent(): boolean {
    try {
        return devices().some(
            (d) => d.vendorId === VID && d.productId === PID && d.interface === 5
        );
    } catch {
        return false;
    }
}

function getDevicePath(): string | null {
    const matches = devices().filter(
        (d) => d.vendorId === VID && d.productId === PID && d.interface === 5
    );
    const target = matches[COL_INDEX] ?? matches[0];
    return target?.path ?? null;
}

// Batteriewert bewusst NICHT nullen: Nach einem Reconnect zeigt die
// Anzeige sofort den letzten bekannten Wert und korrigiert sich beim
// naechsten Batterie-Event. (Das Headset sendet den Wert nicht sofort
// beim Verbinden, sondern nur periodisch/bei Aenderung.)
function markDisconnected(donglePresent: boolean): void {
    updateState("connected", false);
    updateState("dongle_present", donglePresent);
}

function closeHandle(): void {
    if (device) {
        try { device.close(); } catch { /* ignorieren */ }
        device = null;
    }
}

function connect(): void {
    // Doppelte gleichzeitige Verbindungsversuche verhindern
    if (connecting || device) return;
    connecting = true;

    const path = getDevicePath();
    if (!path) {
        connecting = false;
        markDisconnected(false); // kein Dongle im System
        return; // Watchdog kuemmert sich um erneuten Versuch
    }

    try {
        const dev = new HID(path);
        dev.on("data", (data: Buffer) => { if (dataHandler) dataHandler(data); });
        dev.on("error", (err) => {
            streamDeck.logger.warn(`JBL HID error (Verbindung weg): ${err}`);
            handleDrop();
        });
        device = dev;
        connecting = false;
        updateState("dongle_present", true);
        streamDeck.logger.info(`JBL verbunden: ${path}`);
    } catch (err) {
        connecting = false;
        closeHandle();
        markDisconnected(devicePresent());
        streamDeck.logger.warn(`JBL connect fehlgeschlagen: ${err}`);
    }
}

// Verbindung ist weggebrochen (Fehler oder Dongle ab).
function handleDrop(): void {
    closeHandle();
    markDisconnected(devicePresent());
    // sofort einen Reconnect anstossen (mit kleiner Verzoegerung)
    if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, 1500);
    }
}

// Watchdog: prueft alle 2s aktiv den Zustand.
//  - Handle da, aber Dongle weg   -> Verbindung fallenlassen
//  - kein Handle, aber Dongle da  -> reconnecten (Wiedereinstecken!)
function startWatchdog(): void {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        const present = devicePresent();
        if (device && !present) {
            streamDeck.logger.warn("Watchdog: Dongle verschwunden -> NO DONGLE");
            handleDrop();
        } else if (!device && present && !connecting) {
            streamDeck.logger.info("Watchdog: Dongle wieder da -> reconnect");
            connect();
        } else if (!device && !present) {
            // weiterhin kein Dongle -> Status sicherstellen
            markDisconnected(false);
        }
    }, 2000);
}

export function startDevice(onData: (data: Buffer) => void): void {
    dataHandler = onData;
    connect();
    startWatchdog();
}

export function sendFeature(codeA: number, codeB: number, value: number): boolean {
    if (!device) {
        streamDeck.logger.warn("Sendeversuch ohne verbundenes Geraet.");
        return false;
    }
    try {
        const payload = Buffer.alloc(64, 0);
        const header = [
            0x88, 0x00, 0xdd, 0x02, 0x00, 0x01, 0x00, 0x05,
            0x00, codeA, codeB, 0x01, 0x00, value,
        ];
        header.forEach((b, i) => (payload[i] = b));
        const written = device.sendFeatureReport(payload);
        streamDeck.logger.info(
            `sendFeature codeA=0x${codeA.toString(16)} codeB=0x${codeB.toString(16)} value=0x${value.toString(16)} -> ${written} bytes`
        );
        return true;
    } catch (err) {
        streamDeck.logger.error(`Sende-Fehler: ${err}`);
        handleDrop();
        return false;
    }
}

export function isConnected(): boolean {
    return device !== null;
}