// test-eq.ts - test the EQ without Stream Deck (place next to package.json)
//
//   npx tsx test-eq.ts list                       presets from q950.dat + DLL self-test
//   npx tsx test-eq.ts compare eq-presets.json    compare computed blobs with captured ones
//   npx tsx test-eq.ts send "FLAT"                send a preset to the headset
//
// Optional: --dll "PATH\libAirohaEQSerializeImp.dll"
import * as fs from "fs";
import { HID, devices } from "node-hid";
import { initEngine, readPresets, buildInfo, computeCurve } from "./src/eq-engine";

const args = process.argv.slice(2);
const dllIdx = args.indexOf("--dll");
const dllPath = dllIdx >= 0 ? args[dllIdx + 1] : undefined;
const rest = dllIdx >= 0 ? args.filter((_, i) => i !== dllIdx && i !== dllIdx + 1) : args;
const [cmd, arg] = rest;

function engine() {
    const r = initEngine(dllPath);
    console.log(`DLL:       ${r.dll ?? "not found"}`);
    console.log(`Self-test: ${r.ok ? "OK (FLAT matches)" : "FAILED - " + r.error}`);
    if (!r.ok) process.exit(1);
}

function sendFeatureData(dev: HID, fidLow: number, fidHigh: number, data: Buffer) {
    const CHUNK = 54;
    const len = data.length;
    const virt = Buffer.concat([Buffer.from([fidLow, fidHigh, len & 0xff, (len >> 8) & 0xff]), data]);
    const count = Math.max(1, Math.ceil(virt.length / CHUNK));
    for (let index = 0; index < count; index++) {
        const chunk = virt.subarray(index * CHUNK, (index + 1) * CHUNK);
        const payload = Buffer.alloc(64, 0);
        payload.set([0x88, 0x00, 0xdd, 0x02, 0x00, count, index, chunk.length & 0xff, (chunk.length >> 8) & 0xff], 0);
        chunk.copy(payload, 9);
        dev.sendFeatureReport(payload);
    }
    console.log(`  sent fid=0x${((fidHigh << 8) | fidLow).toString(16)}: ${len} bytes in ${count} reports`);
}

if (cmd === "list") {
    const { presets, current } = readPresets();
    console.log(`Active in q950.dat: ${current}`);
    for (const p of presets) console.log(`  ${p.isSystem ? "system" : "custom"}  ${p.name.padEnd(20)} ${p.gains.join(", ")}`);
    engine();
} else if (cmd === "compare") {
    engine();
    const ref = JSON.parse(fs.readFileSync(arg ?? "eq-presets.json", "utf-8")).presets;
    let ok = 0, bad = 0;
    for (const p of readPresets().presets) {
        const r = Object.values<any>(ref).find((x) => x.name === p.name || x.name?.toUpperCase() === p.name.toUpperCase());
        if (!r) continue;
        const same = computeCurve(p).toString("hex") === r.curve_hex && buildInfo(p).toString("hex") === r.info_hex;
        console.log(`  ${same ? "OK  " : "DIFF"}  ${p.name}`);
        same ? ok++ : bad++;
    }
    console.log(`Result: ${ok} identical, ${bad} different`);
} else if (cmd === "send" && arg) {
    engine();
    const p = readPresets().presets.find((x) => x.name === arg);
    if (!p) { console.log(`Preset "${arg}" not found in q950.dat`); process.exit(1); }
    const info = buildInfo(p);
    const curve = computeCurve(p);
    const m = devices().filter((d) => d.vendorId === 0x0ecb && d.productId === 0x2127 && d.interface === 5);
    const target = m[3] ?? m[0];
    if (!target?.path) { console.log("Dongle not found"); process.exit(1); }
    const dev = new HID(target.path);
    try {
        sendFeatureData(dev, 0x02, 0x0e, info);
        await new Promise((r) => setTimeout(r, 150)); // short pause like QuantumENGINE
        sendFeatureData(dev, 0x7f, 0x0e, curve);
        console.log(`Preset "${p.name}" sent.`);
    } finally {
        dev.close();
    }
} else {
    console.log('Usage: npx tsx test-eq.ts list | compare [eq-presets.json] | send "NAME"   [--dll PATH]');
}
