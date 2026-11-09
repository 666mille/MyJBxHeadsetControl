// src/jbl-device.ts
// Shared HID handle for reading events and sending commands.
import { HID } from "node-hid";
import streamDeck from "@elgato/streamdeck";
import { updateState } from "./state";
import { findJblPath, listCollections } from "./jbl-path";

const CHUNK = 54; // payload bytes per report, same as QuantumENGINE

let device: HID | null = null;
let devicePath: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let dataHandler: ((data: Buffer) => void) | null = null;
let connecting = false;
let watchdogTicks = 0;

// GET requests (category 0x01). The dongle answers in the same format as the events.
// It answers from its cache even while the headset is off, except 0x35, which reports
// the real link state (0x80 = headset connected). See jbl-listener.ts.
const STATE_QUERIES: [number, number][] = [
    [0x35, 0x00], // connected
    [0x0d, 0x00], // battery
    [0x03, 0x0c], // mute
    [0x18, 0x00], // ANC
    [0x19, 0x00], // Ambient Aware
    [0x21, 0x00], // spatial sound
    [0x14, 0x00], // game/chat balance
];
const LINK_CHECK_TICKS = 30; // watchdog runs every 2 s -> link check every 60 s

function devicePresent(): boolean {
    return listCollections().length > 0;
}

function getDevicePath(): string | null {
    return findJblPath((level, msg) => streamDeck.logger[level](msg));
}

// Keep the battery value on purpose: after a reconnect the last known value is
// shown until the next battery event arrives.
function markDisconnected(donglePresent: boolean): void {
    updateState("connected", false);
    updateState("dongle_present", donglePresent);
}

function closeHandle(): void {
    if (device) {
        try { device.close(); } catch { /* ignore */ }
        device = null;
        devicePath = null;
    }
}

function connect(): void {
    if (connecting || device) return;
    connecting = true;

    const path = getDevicePath();
    if (!path) {
        connecting = false;
        markDisconnected(false); // no dongle, watchdog retries
        return;
    }

    try {
        const dev = new HID(path);
        dev.on("data", (data: Buffer) => { if (dataHandler) dataHandler(data); });
        dev.on("error", (err) => {
            streamDeck.logger.warn(`JBL HID error (connection lost): ${err}`);
            handleDrop();
        });
        device = dev;
        devicePath = path;
        connecting = false;
        updateState("dongle_present", true);
        streamDeck.logger.info(`JBL connected: ${path}`);
        // the headset may already be on (e.g. PC started after it): ask instead of waiting for events
        setTimeout(() => queryState(), 200);
    } catch (err) {
        connecting = false;
        closeHandle();
        markDisconnected(devicePresent());
        streamDeck.logger.warn(`JBL connect failed: ${err}`);
    }
}

// Connection dropped (error or dongle unplugged)
function handleDrop(): void {
    closeHandle();
    markDisconnected(devicePresent());
    if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, 1500);
    }
}

// Checks every 2 s: drop the handle if the dongle is gone or its collection path
// changed (re-enumeration), reconnect when it is back.
function startWatchdog(): void {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        const collections = listCollections();
        const present = collections.length > 0;
        if (device && !present) {
            streamDeck.logger.warn("Watchdog: dongle gone");
            handleDrop();
        } else if (device && devicePath && !collections.some((d) => d.path === devicePath)) {
            streamDeck.logger.warn("Watchdog: collection path changed, reconnecting");
            handleDrop();
        } else if (!device && present && !connecting) {
            streamDeck.logger.info("Watchdog: dongle back, reconnecting");
            connect();
        } else if (!device && !present) {
            markDisconnected(false);
        }
        // safety net in case a connect/disconnect event was missed
        if (device && ++watchdogTicks >= LINK_CHECK_TICKS) {
            watchdogTicks = 0;
            sendGet(0x35, 0x00);
        }
    }, 2000);
}

export function startDevice(onData: (data: Buffer) => void): void {
    dataHandler = onData;
    connect();
    startWatchdog();
}

/** GET request; the answer arrives as a normal input report (category 0x01). */
export function sendGet(codeA: number, codeB: number): boolean {
    if (!device) return false;
    try {
        const payload = Buffer.alloc(64, 0);
        payload.set([0x88, 0x00, 0xdd, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, codeA, codeB], 0);
        device.sendFeatureReport(payload);
        return true;
    } catch (err) {
        streamDeck.logger.error(`GET ${codeA.toString(16)} failed: ${err}`);
        handleDrop();
        return false;
    }
}

// Pending GET requests waiting for their answer (see jbl-listener.ts -> deliverGetAnswer).
const getWaiters = new Map<string, ((value: number) => void)[]>();

/** Sends a GET and resolves with the answered value, or null after the timeout. */
export function queryValue(codeA: number, codeB: number, timeoutMs = 400): Promise<number | null> {
    return new Promise((resolve) => {
        const key = `${codeA}:${codeB}`;
        let done = false;
        const finish = (v: number | null) => { if (!done) { done = true; resolve(v); } };
        const list = getWaiters.get(key) ?? [];
        list.push((v) => finish(v));
        getWaiters.set(key, list);
        setTimeout(() => finish(null), timeoutMs);
        if (!sendGet(codeA, codeB)) finish(null);
    });
}

/** Called by the listener for every GET answer (category 0x01). */
export function deliverGetAnswer(codeA: number, codeB: number, value: number): void {
    const key = `${codeA}:${codeB}`;
    const list = getWaiters.get(key);
    if (!list) return;
    getWaiters.delete(key);
    list.forEach((f) => f(value));
}

/** Refreshes the given values from the dongle; the listener updates the state. */
export async function syncFromDongle(codes: [number, number][]): Promise<void> {
    for (const [a, b] of codes) await queryValue(a, b, 250);
}

/** Asks for link state and all status values, spaced out a little. */
export function queryState(): void {
    STATE_QUERIES.forEach(([a, b], i) => setTimeout(() => sendGet(a, b), i * 60));
}

export function sendFeature(codeA: number, codeB: number, value: number): boolean {
    if (!device) {
        streamDeck.logger.warn("Send without connected device.");
        return false;
    }
    try {
        const payload = Buffer.alloc(64, 0);
        const header = [
            0x88, 0x00, 0xdd, 0x02, 0x00, 0x01, 0x00, 0x05,
            0x00, codeA, codeB, 0x01, 0x00, value,
        ];
        header.forEach((b, i) => (payload[i] = b));
        device.sendFeatureReport(payload);
        return true;
    } catch (err) {
        streamDeck.logger.error(`Send error: ${err}`);
        handleDrop();
        return false;
    }
}

// Multi-packet feature write for large payloads (EQ 0x0E02 / 0x0E7F)
export function sendFeatureData(fidLow: number, fidHigh: number, data: Buffer): boolean {
    if (!device) {
        streamDeck.logger.warn("Send without connected device.");
        return false;
    }
    const len = data.length;
    const virt = Buffer.concat([Buffer.from([fidLow, fidHigh, len & 0xff, (len >> 8) & 0xff]), data]);
    const count = Math.max(1, Math.ceil(virt.length / CHUNK));
    try {
        for (let index = 0; index < count; index++) {
            const chunk = virt.subarray(index * CHUNK, (index + 1) * CHUNK);
            const payload = Buffer.alloc(64, 0);
            payload.set([0x88, 0x00, 0xdd, 0x02, 0x00, count, index,
                         chunk.length & 0xff, (chunk.length >> 8) & 0xff], 0);
            chunk.copy(payload, 9);
            device.sendFeatureReport(payload);
        }
        return true;
    } catch (err) {
        streamDeck.logger.error(`Send error: ${err}`);
        handleDrop();
        return false;
    }
}

export function isConnected(): boolean {
    return device !== null;
}
