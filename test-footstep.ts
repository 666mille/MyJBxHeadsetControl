// test-footstep.ts - test the QuantumENGINE IPC without Stream Deck (place next to package.json)
//
//   npx tsx test-footstep.ts          read Footstep Booster state
//   npx tsx test-footstep.ts on|off   switch it
//   npx tsx test-footstep.ts eq NAME  switch the EQ preset through the service
//   npx tsx test-footstep.ts game NAME  switch the footstep game (internal name, e.g. Overwatch2)
//   npx tsx test-footstep.ts level N    set the footstep strength (0-100)
//
// Requires QuantumENGINE running and the headset switched on.
import { listCollections } from "./src/jbl-path";
import * as ipc from "./src/qe-ipc";

const serial = listCollections().find((d) => d.serialNumber)?.serialNumber;
if (!serial) { console.log("Dongle not found"); process.exit(1); }
const name = `Q950/USB\\VID_0ECB&PID_2127\\${serial}`;
console.log(`Channel:  ${name}`);

if (!(await ipc.openChannel(name))) { console.log("Service not reachable"); process.exit(1); }

async function show() {
    const en = await ipc.getSync(20796, 20799);
    const nm = await ipc.getSync(20790, 20793);
    const pc = await ipc.getSync(20802, 20805);
    console.log(`Booster:  ${en ? (en.readInt32LE(0) ? "ON" : "OFF") : "no answer"}`);
    console.log(`Game:     ${nm ? ipc.decodeString(nm) : "?"}`);
    console.log(`Strength: ${pc ? pc.readUInt32LE(0) + " %" : "?"}`);
}

await show();
const eq = await ipc.getSync(20993, 20995);
console.log(`EQ:       ${eq ? ipc.decodeString(eq) : "?"}`);
const arg = process.argv[2];
if (arg === "eq" && process.argv[3]) {
    console.log(`\nEQ -> ${process.argv[3]}: ${await ipc.sendString(21006, process.argv[3])}`);
    await new Promise((r) => setTimeout(r, 1500));
    const now = await ipc.getSync(20993, 20995);
    console.log(`EQ now:   ${now ? ipc.decodeString(now) : "?"}`);
}
if (arg === "game" && process.argv[3]) {
    console.log(`\nGame -> ${process.argv[3]}: ${await ipc.sendString(20791, process.argv[3])}`);
    await new Promise((r) => setTimeout(r, 300));
    await show();
}
if (arg === "level" && process.argv[3]) {
    const n = Math.max(0, Math.min(100, Number(process.argv[3])));
    console.log(`\nLevel -> ${n}: ${await ipc.sendInt(20803, n, true)}`);
    await new Promise((r) => setTimeout(r, 300));
    await show();
}
if (arg === "on" || arg === "off") {
    console.log(`\nSwitching ${arg} -> ${await ipc.sendInt(20797, arg === "on" ? 1 : 0)}`);
    await new Promise((r) => setTimeout(r, 300));
    await show();
}
const cfg = await ipc.getSync(20785, 20787);
if (cfg) console.log(`\nGames:    ${ipc.decodeString(cfg)}`);
await ipc.resetClient();
process.exit(0); // IPC.dll threads would keep Node alive
