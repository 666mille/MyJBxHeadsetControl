// src/footstep.ts
// Footstep Booster. Unlike everything else in this plugin it does not run on the
// headset: QuantumENGINE applies it to the game audio on the PC. So it is
// controlled through the QuantumENGINE service (qe-service.ts), not over HID.
//
// Message IDs from QuantumENGINE (QECommon.AEFootStep*Prop):
//   Enable   int  0/1   Get 20796 / Resp 20799 / Set 20797 / Sub 20800 / Notify 20798
//   Name     string     Get 20790 / Resp 20793 / Set 20791 / Sub 20794 / Notify 20792
//   Percent  uint 0-100 Get 20802 / Resp 20805 / Set 20803 / Sub 20806 / Notify 20804
//   Config   string     Get 20785 / Resp 20787               (JSON list of games)
//
// The service does not notify other clients when a client sets one of these
// values, so the QuantumENGINE window only shows changes made here after it is
// reopened, and changes made there reach us through the poll.
import streamDeck from "@elgato/streamdeck";
import { readState, updateState } from "./state";
import * as qe from "./qe-service";

const MSG = {
    enableGet: 20796, enableResp: 20799, enableSet: 20797, enableSub: 20800, enableNotify: 20798,
    nameGet: 20790, nameResp: 20793, nameSet: 20791, nameSub: 20794, nameNotify: 20792,
    percentGet: 20802, percentResp: 20805, percentSet: 20803, percentSub: 20806, percentNotify: 20804,
    configGet: 20785, configResp: 20787,
};

export interface FootstepGame { name: string; display: string }

// The service sends [{"name":"Counter_Strike2","display":"Counter-Strike 2"}, ...];
// the C# side calls the fields Name/DisplayName, so accept both spellings.
function parseGames(json: string): FootstepGame[] {
    try {
        const list = JSON.parse(json) as Record<string, string | undefined>[];
        return list.map((g) => {
            const name = g.name || g.Name || "DEFAULT";
            return { name, display: g.display || g.DisplayName || name };
        });
    } catch {
        return [];
    }
}

const setEnabled = (p: Buffer) => { if (p.length >= 4) updateState("footstep_enabled", p.readInt32LE(0) !== 0); };
const setGame = (p: Buffer) => updateState("footstep_game", qe.decodeString(p));
const setPercent = (p: Buffer) => { if (p.length >= 4) updateState("footstep_percent", Math.min(100, p.readUInt32LE(0))); };

qe.registerProp(MSG.enableSub, MSG.enableNotify, setEnabled);
qe.registerProp(MSG.nameSub, MSG.nameNotify, setGame);
qe.registerProp(MSG.percentSub, MSG.percentNotify, setPercent);

async function readAll(): Promise<boolean> {
    const en = await qe.getSync(MSG.enableGet, MSG.enableResp);
    if (!en || en.length < 4) return false;
    setEnabled(en);
    const nm = await qe.getSync(MSG.nameGet, MSG.nameResp);
    if (nm) setGame(nm);
    const pc = await qe.getSync(MSG.percentGet, MSG.percentResp);
    if (pc) setPercent(pc);
    if (!readState().footstep_games?.length) {
        const cfg = await qe.getSync(MSG.configGet, MSG.configResp);
        const games = cfg ? parseGames(qe.decodeString(cfg)) : [];
        if (games.length) updateState("footstep_games", games);
    }
    return true;
}

// Only polled while a footstep key is visible (see acquireFootstep).
let footstepUsers = 0;
qe.registerPoller(async () => (footstepUsers > 0 ? readAll() : true));

async function setAndConfirm(send: () => Promise<boolean>): Promise<boolean> {
    return qe.serial(async () => {
        if (!(await qe.ensureChannel(true))) return false;
        if (!(await send())) return false;
        await new Promise((r) => setTimeout(r, 150));
        if (!(await readAll())) { await qe.channelBroken(); return false; } // read back: the service is the source of truth
        updateState("qe_available", true);
        return true;
    });
}

export function setFootstepEnabled(on: boolean): Promise<boolean> {
    return setAndConfirm(() => qe.sendInt(MSG.enableSet, on ? 1 : 0));
}

export function setFootstepGame(name: string): Promise<boolean> {
    return setAndConfirm(() => qe.sendString(MSG.nameSet, name));
}

export function setFootstepPercent(percent: number): Promise<boolean> {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    return setAndConfirm(() => qe.sendInt(MSG.percentSet, p, true));
}

export function gameDisplayName(name: string | undefined): string {
    if (!name) return "";
    const games: FootstepGame[] = readState().footstep_games ?? [];
    return games.find((g) => g.name === name)?.display ?? name.replace(/_/g, " ");
}

export const refreshFootstep = () => qe.checkNow();

export function acquireFootstep(): void {
    footstepUsers++;
    qe.acquireService();
}

export function releaseFootstep(): void {
    footstepUsers = Math.max(0, footstepUsers - 1);
    qe.releaseService();
}

/** Answer for the game dropdown in the property inspector (sdpi datasource "getGames"). */
export async function answerGameList(): Promise<void> {
    if (!readState().footstep_games?.length) await qe.checkNow();
    const games: FootstepGame[] = readState().footstep_games ?? [];
    const items: { label: string; value: string; disabled?: boolean }[] = [
        { label: "- (on/off only) -", value: "" },
        ...games.map((g) => ({ label: g.display, value: g.name })),
    ];
    if (!games.length) items.push({ label: "QuantumENGINE not reachable", value: "-", disabled: true });
    await streamDeck.ui.sendToPropertyInspector({ event: "getGames", items });
}
