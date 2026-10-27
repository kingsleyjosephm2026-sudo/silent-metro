// Scripted end-to-end walkthrough of the event pipeline (no server, no network). All data is DEMO.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Store } from "../src/store.js";
import { EventService } from "../src/event-service.js";
import { Simulator } from "../src/simulator.js";
import { stationById } from "../src/stations.js";

let t = Date.now();
const clock = { now: () => t };
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sm-demo-")), "db.json");
const store = new Store(file);
const service = new EventService(store, () => {}, { clock });
const sim = new Simulator(service, store, { clock });

console.log("=== Silent Metro pipeline walkthrough: DEMO / SIMULATED data only ===\n");
const show = (label, r) => {
  console.log(`${label.padEnd(26)} -> ${String(r.code).padEnd(22)} applied=${String(r.applied).padEnd(5)} ${r.reason ?? r.error ?? ""}`);
  if (r.notification) console.log(`    ANNOUNCE: ${r.notification.text}   vibrate=${JSON.stringify(r.notification.vibration)}`);
};
const wait = (ms = 11000) => { t += ms; };
for (let i = 0; i < 3; i++) { wait(); show("simulator step", sim.step()); }
show("duplicate retransmit", sim.inject("duplicate")); wait();
show("invalid payload", sim.inject("invalid")); wait();
show("missed sensor (skip)", sim.inject("skip")); wait();
show("out-of-order sequence", sim.inject("out-of-order")); wait();
show("delayed 2 minutes", sim.inject("delayed")); wait();
show("spoofed identity", service.ingest({ schemaVersion: 1, eventId: "spoof-1", deviceId: "sim-01", eventType: "HEARTBEAT", sequence: 0, deviceTimestamp: new Date(t).toISOString(), source: "SIMULATOR" }, "esp32-demo-01"));
show("device restart", sim.inject("restart"));
t += 400000;
const blue = service.publicSnapshot().lines[0];
console.log(`\nBlue line freshness after 400 s of silence: ${blue.freshness} (last detected: ${stationById(blue.state.stationId).name})`);
service.checkDevices();
console.log("Device statuses:", service.deviceViews().map((d) => `${d.deviceId}=${d.connection}`).join(", "));
console.log("Operator alerts:"); for (const a of service.db.alerts.slice(-6)) console.log(`  [${a.severity}] ${a.title}`);
const a = service.analytics();
console.log("\nAnalytics derived from stored events:", JSON.stringify({ total: a.totalEvents, byCode: a.byCode, duplicateRate: `${a.duplicateRate}%`, flaggedRate: `${a.flaggedRate}%`, simulated: a.containsSimulatedData }, null, 2));
