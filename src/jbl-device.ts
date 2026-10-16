// src/jbl-device.ts
// Shared HID handle for reading events and sending commands.
import { HID, devices } from "node-hid";
import streamDeck from "@elgato/streamdeck";
import { updateState } from "./state";

const VID = 0x0ecb;
const PID = 0x2127;
const COL_INDEX = 3;
const CHUNK = 54; // payload bytes per report, same as QuantumENGINE

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
        connecting = false;
        updateState("dongle_present", true);
        streamDeck.logger.info(`JBL connected: ${path}`);
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

// Checks every 2 s: drop the handle if the dongle is gone, reconnect when it is back.
function startWatchdog(): void {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        const present = devicePresent();
        if (device && !present) {
            streamDeck.logger.warn("Watchdog: dongle gone");
            handleDrop();
        } else if (!device && present && !connecting) {
            streamDeck.logger.info("Watchdog: dongle back, reconnecting");
            connect();
        } else if (!device && !present) {
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
