import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { EventService } from "../src/event-service.js";
import { Simulator } from "../src/simulator.js";
import { ManualClock, tmpFile, mkEvent } from "./helpers.js";

function setup(config) {
  const clock = new ManualClock(), file = tmpFile(), store = new Store(file);
  const service = new EventService(store, () => {}, { clock, config });
  return { clock, file, store, service };
}
const send = (svc, clock, over, dev = "esp32-demo-01") => svc.ingest(mkEvent(clock, over), dev);

test("accepted arrival updates state and creates a labelled notification", () => {
  const { service, clock } = setup();
  const r = send(service, clock, { source: "SIMULATOR", deviceId: "sim-01" }, "sim-01");
  assert.equal(r.accepted, true); assert.equal(r.applied, true);
  assert.match(r.notification.text, /^\[DEMO\] Arrived at North Gate\. Terminal station\. Next station: Market Square\.$/);
  assert.equal(r.notification.provenance, "DEMO");
  assert.equal(service.publicSnapshot().lines[0].state.stationId, "north-gate");
});
test("hardware events are labelled PROTOTYPE_HARDWARE, not DEMO", () => {
  const { service, clock } = setup();
  const r = send(service, clock);
  assert.equal(r.notification.provenance, "PROTOTYPE_HARDWARE"); assert.ok(!r.notification.text.includes("[DEMO]"));
});
test("duplicate is idempotent: no second transition or notification", () => {
  const { service, clock } = setup();
  const e = mkEvent(clock, { sequence: 0 });
  service.ingest(e, "esp32-demo-01");
  const d = service.ingest(e, "esp32-demo-01");
  assert.equal(d.status, "duplicate"); assert.equal(d.applied, false); assert.equal(d.notification, null); assert.equal(d.httpStatus, 200);
  assert.equal(service.db.events.filter((x) => x.applied).length, 1);
});
test("out-of-order sequence is flagged without changing state", () => {
  const { service, clock } = setup();
  send(service, clock, { sequence: 5, stationId: "north-gate" });
  const r = send(service, clock, { sequence: 3, stationId: "market-square" });
  assert.equal(r.code, "out_of_order"); assert.equal(service.db.state.lines.blue.stationId, "north-gate");
});
test("delayed event is stored as stale and not applied", () => {
  const { service, clock } = setup();
  const r = send(service, clock, { deviceTimestamp: new Date(clock.now() - 120000).toISOString() });
  assert.equal(r.code, "stale"); assert.equal(r.applied, false); assert.equal(service.db.state.lines.blue, undefined);
});
test("future timestamp is flagged", () => {
  const { service, clock } = setup();
  assert.equal(send(service, clock, { deviceTimestamp: new Date(clock.now() + 60000).toISOString() }).code, "future_timestamp");
});
test("skipped station is flagged; same station twice resyncs", () => {
  const { service, clock } = setup();
  send(service, clock, { sequence: 0, stationId: "north-gate" });
  const a = send(service, clock, { sequence: 1, stationId: "central" });
  assert.equal(a.code, "unexpected_transition"); assert.equal(service.db.state.lines.blue.stationId, "north-gate");
  assert.ok(service.db.alerts.some((x) => x.code === "unexpected_transition"));
  const b = send(service, clock, { sequence: 2, stationId: "central" });
  assert.equal(b.accepted, true); assert.equal(service.db.state.lines.blue.stationId, "central");
});
test("device restart (new bootId) accepted; replay from old boot rejected", () => {
  const { service, clock } = setup();
  send(service, clock, { bootId: "A", sequence: 0, stationId: "north-gate" });
  send(service, clock, { bootId: "A", sequence: 1, stationId: "market-square" });
  assert.equal(send(service, clock, { bootId: "B", sequence: 0, eventType: "HEARTBEAT", lineId: undefined, stationId: undefined }).accepted, true);
  assert.equal(send(service, clock, { bootId: "B", sequence: 1, stationId: "central" }).accepted, true);
  assert.equal(send(service, clock, { bootId: "A", sequence: 9, stationId: "riverside" }).code, "out_of_order");
});
test("authorization: mismatch, unknown, revoked, unassigned", () => {
  const { service, clock } = setup();
  assert.equal(service.ingest(mkEvent(clock), "sim-01").code, "device_mismatch");
  assert.equal(service.ingest(mkEvent(clock, { deviceId: "ghost" }), "ghost").code, "unknown_device");
  service.db.devices["esp32-demo-01"].revoked = true;
  assert.equal(send(service, clock).code, "revoked_device");
  service.db.devices["esp32-demo-01"].revoked = false;
  service.db.devices["esp32-demo-01"].assignedStations = ["north-gate"];
  assert.equal(send(service, clock, { sequence: 0, stationId: "market-square" }).code, "unassigned_station");
  assert.equal(service.db.state.lines.blue, undefined);
  assert.ok(service.db.alerts.some((a) => a.severity === "critical"));
});
test("invalid payloads are rejected and the raw payload is not stored", () => {
  const { service } = setup();
  for (const bad of [null, "DROP TABLE", { a: 1 }, { schemaVersion: 1, eventId: "x" }]) { const r = service.ingest(bad, "esp32-demo-01"); assert.equal(r.code, "invalid_schema"); assert.equal(r.httpStatus, 422); }
  assert.ok(!JSON.stringify(service.db.events).includes("DROP TABLE"));
  assert.equal(service.db.state.lines.blue, undefined);
});
test("unknown line/station flagged", () => {
  const { service, clock } = setup();
  assert.equal(send(service, clock, { stationId: "atlantis" }).code, "unknown_line_or_station");
  assert.equal(send(service, clock, { sequence: 1, lineId: "purple" }).code, "unknown_line_or_station");
});
test("sensor fault raises an operator alert and does not change state", () => {
  const { service, clock } = setup();
  const r = send(service, clock, { eventType: "SENSOR_FAULT" });
  assert.equal(r.accepted, true); assert.equal(r.applied, false); assert.ok(service.db.alerts.some((a) => a.code === "sensor_fault"));
});
test("operator alerts are rate limited per device+code", () => {
  const { service } = setup();
  service.ingest({}, "esp32-demo-01"); service.ingest({}, "esp32-demo-01");
  assert.equal(service.db.alerts.filter((a) => a.code === "invalid_schema").length, 1);
});
test("device offline and stale-data indicators", () => {
  const { service, clock } = setup();
  assert.equal(service.deviceViews().find((d) => d.deviceId === "esp32-demo-01").connection, "never_seen");
  assert.equal(service.publicSnapshot().lines[0].freshness, "unknown");
  send(service, clock);
  assert.equal(service.deviceViews().find((d) => d.deviceId === "esp32-demo-01").connection, "online");
  assert.equal(service.publicSnapshot().lines[0].freshness, "fresh");
  clock.advance(61000);
  assert.equal(service.deviceViews().find((d) => d.deviceId === "esp32-demo-01").connection, "offline");
  assert.equal(service.checkDevices(), true);
  assert.ok(service.db.alerts.some((a) => a.code === "device_offline"));
  assert.equal(service.checkDevices(), false); // alerted only once per outage
  clock.advance(300000);
  assert.equal(service.publicSnapshot().lines[0].freshness, "stale");
});
test("heartbeat refreshes device liveness but not line freshness", () => {
  const { service, clock } = setup();
  send(service, clock); clock.advance(400000);
  send(service, clock, { sequence: 1, eventType: "HEARTBEAT", lineId: undefined, stationId: undefined });
  assert.equal(service.deviceViews()[0].connection, "online"); assert.equal(service.publicSnapshot().lines[0].freshness, "stale");
});
test("state, devices and duplicate memory persist across restarts", () => {
  const { service, clock, file } = setup();
  const e1 = mkEvent(clock, { sequence: 0 }), e2 = mkEvent(clock, { sequence: 1, stationId: "market-square" });
  service.ingest(e1, "esp32-demo-01"); service.ingest(e2, "esp32-demo-01");
  const service2 = new EventService(new Store(file), () => {}, { clock });
  assert.equal(service2.db.state.lines.blue.stationId, "market-square");
  assert.equal(service2.ingest(e2, "esp32-demo-01").status, "duplicate");
  assert.equal(service2.ingest(mkEvent(clock, { sequence: 2, stationId: "central" }), "esp32-demo-01").accepted, true);
});
test("retention caps keep the event log bounded", () => {
  const { service, clock } = setup({ maxEvents: 5 });
  for (let i = 0; i < 12; i++) send(service, clock, { sequence: i, eventType: "HEARTBEAT", lineId: undefined, stationId: undefined });
  assert.equal(service.db.events.length, 5);
});
test("analytics are derived from stored events", () => {
  const { service, clock } = setup();
  const sim = new Simulator(service, service.store, { clock });
  sim.step(); clock.advance(2000); sim.step(); sim.inject("duplicate"); sim.inject("invalid");
  const a = service.analytics();
  assert.equal(a.totalEvents, 4); assert.equal(a.accepted, 2); assert.equal(a.duplicates, 1); assert.equal(a.rejected, 1);
  assert.equal(a.duplicateRate, 25); assert.equal(a.containsSimulatedData, true);
  assert.equal(Object.values(a.arrivalsByStation).reduce((x, y) => x + y, 0), 2);
  assert.ok(a.notes.some((n) => n.includes("SIMULATED")));
});
test("simulator walks the line, reverses at the end, labels events, and supports pause/step", () => {
  const { service, clock } = setup({ resyncAfter: 2 });
  const sim = new Simulator(service, service.store, { clock });
  const seen = [];
  for (let i = 0; i < 8; i++) { clock.advance(11000); const r = sim.step(); assert.equal(r.accepted, true, r.reason); seen.push(r.sent.stationId); }
  assert.deepEqual(seen, ["north-gate", "market-square", "central", "riverside", "harbour-view", "east-terminal", "harbour-view", "riverside"]);
  sim.running = false; assert.equal(sim.tick(), null); assert.equal(service.publicSnapshot().simulatorRunning, false);
  assert.ok(service.db.events.every((e) => e.source === "SIMULATOR" && e.provenance === "DEMO"));
});
test("simulator injections trigger the intended pipeline decisions", () => {
  const { service, clock } = setup();
  const sim = new Simulator(service, service.store, { clock });
  sim.step(); clock.advance(11000); sim.step();
  assert.equal(sim.inject("duplicate").status, "duplicate");
  assert.equal(sim.inject("out-of-order").code, "out_of_order");
  assert.equal(sim.inject("invalid").code, "invalid_schema");
  assert.equal(sim.inject("delayed").code, "stale");
  assert.equal(sim.inject("sensor-fault").accepted, true);
  assert.equal(sim.inject("restart").accepted, true);
  assert.equal(sim.inject("nonsense").error, "unknown_injection");
});
