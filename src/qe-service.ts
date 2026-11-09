// src/qe-service.ts
// Shared connection to the QuantumENGINE service for all features that use it
// (Footstep Booster, EQ via the service). Opens the product channel lazily,
// subscribes to the registered properties, dispatches Notify messages and runs
// a light poll as long as at least one action using the service is visible.
import streamDeck from "@elgato/streamdeck";
import { readState, updateState } from "./state";
import { listCollections } from "./jbl-path";
import * as ipc from "./qe-ipc";

const POLL_MS = 3000;
const RETRY_MS = 15000;

type Handler = (payload: Buffer) => void;
type Poller = () => Promise<boolean>; // false = no answer, channel is considered broken

const subscribeIds: number[] = [];
const notifyHandlers = new Map<number, Handler>();
const pollers: Poller[] = [];

let users = 0;
let pollTimer: NodeJS.Timeout | null = null;
let queue: Promise<any> = Promise.resolve();
let lastFailure = 0;
let lastError = "";
let lastSubscribe = 0;

/**
 * Right after subscribing, the service answers every subscription with its cached value.
 * For some HID values that cache is not reliable (e.g. game/chat balance reads 0x00),
 * so handlers of device values ignore notifications in this window; the plugin gets the
 * real start values from the dongle (jbl-device.ts queryState).
 */
export function inStartupWindow(): boolean {
    return Date.now() - lastSubscribe < 1500;
}

ipc.setNotifyHandler((id, payload) => {
    try { notifyHandlers.get(id)?.(payload); } catch { /* ignore */ }
});

/** Registers a property for Subscribe/Notify. Call at module load. */
export function registerProp(subscribeId: number, notifyId: number, handler: Handler): void {
    subscribeIds.push(subscribeId);
    notifyHandlers.set(notifyId, handler);
}

/** Registers a poll function (Get requests). Call at module load. */
export function registerPoller(fn: Poller): void {
    pollers.push(fn);
}

/** Runs IPC operations one after another. */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
}

/** Channel name = product / USB instance path of the dongle, as QuantumENGINE uses it. */
function channelName(): string | null {
    const serialNo = listCollections().find((d) => d.serialNumber)?.serialNumber;
    return serialNo ? `Q950/USB\\VID_0ECB&PID_2127\\${serialNo}` : null;
}

function markUnavailable(reason: string): void {
    if (reason !== lastError) streamDeck.logger.warn(`QuantumENGINE: ${reason}`);
    lastError = reason;
    lastFailure = Date.now();
    updateState("qe_available", false);
}

function markAvailable(): void {
    if (lastError) streamDeck.logger.info("QuantumENGINE: connected");
    lastError = "";
    updateState("qe_available", true);
}

/**
 * Makes sure the channel is open. Must run inside serial().
 * force = true for user actions: ignore the retry pause after a failure.
 */
export async function ensureChannel(force = false): Promise<boolean> {
    if (!readState().connected) return false; // the product channel needs the headset
    if (!force && readState().qe_available === false && Date.now() - lastFailure < RETRY_MS) return false;
    const name = channelName();
    if (!name) return false;
    try {
        const r = await ipc.openChannel(name);
        if (!r) { markUnavailable("service not reachable"); return false; }
        if (r === "new" && subscribeIds.length) {
            lastSubscribe = Date.now();
            await ipc.subscribe(subscribeIds);
        }
        return true;
    } catch (err) {
        markUnavailable(String((err as any)?.message ?? err));
        return false;
    }
}

/** Called when a Get request got no answer: start over on the next attempt. */
export async function channelBroken(): Promise<void> {
    await ipc.resetClient();
    markUnavailable("no answer from the service");
}

async function runPollers(): Promise<boolean> {
    for (const p of pollers) {
        if (!(await p())) return false;
    }
    return true;
}

async function poll(force = false): Promise<void> {
    await serial(async () => {
        if (!(await ensureChannel(force))) return;
        if (await runPollers()) { markAvailable(); return; }
        // The channel can go stale (headset reconnected, service restarted):
        // reconnect once right away before reporting the service as unavailable.
        await ipc.resetClient();
        if (!(await ensureChannel(true))) return;
        if (await runPollers()) { markAvailable(); return; }
        markUnavailable("no answer from the service");
    });
}

/** One immediate check, e.g. after a key press while the service was unavailable. */
export function checkNow(): Promise<void> {
    return poll(true);
}

/** Polling and subscriptions run while at least one action using the service is visible. */
export function acquireService(): void {
    users++;
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(() => { poll(); }, POLL_MS);
}

export function releaseService(): void {
    users = Math.max(0, users - 1);
    if (users === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        serial(() => ipc.closeChannel()); // also ends the subscriptions
    }
}

export { getSync, sendInt, sendString, sendPayload, decodeString } from "./qe-ipc";
