import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEvent } from "../src/validator.js";

const good = () => ({ schemaVersion: 1, eventId: "e-1", deviceId: "esp32-demo-01", lineId: "blue", stationId: "central", eventType: "ARRIVAL", sequence: 1, deviceTimestamp: "2026-10-27T10:00:00.000Z", source: "ESP32" });

test("accepts the documented protocol example", () => {
  const r = validateEvent(good());
  assert.equal(r.ok, true);
  assert.equal(r.event.bootId, "boot0");
});
test("rejects non-objects", () => { for (const b of [null, "x", 1, [], undefined]) assert.equal(validateEvent(b).ok, false); });
test("rejects bad types, ids, enums and timestamps", () => {
  const bad = [
    { sequence: -1 }, { sequence: 1.5 }, { sequence: "1" }, { eventId: "has space" }, { eventId: "x".repeat(65) },
    { eventType: "EXPLODE" }, { source: "REAL_TRAIN" }, { schemaVersion: 2 }, { deviceTimestamp: "yesterday" }, { deviceTimestamp: "2026-13-45T99:00:00Z" },
    { stationId: "Central!" }, { lineId: 5 }
  ];
  for (const o of bad) assert.equal(validateEvent({ ...good(), ...o }).ok, false, JSON.stringify(o));
});
test("rejects unknown fields without echoing their values", () => {
  const r = validateEvent({ ...good(), evil: "<script>alert(1)</script>" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith("unknown field: evil")));
  assert.ok(!r.errors.join(" ").includes("<script>"));
});
test("ARRIVAL and SENSOR_FAULT need line+station; HEARTBEAT does not", () => {
  const a = good(); delete a.stationId; assert.equal(validateEvent(a).ok, false);
  const h = { ...good(), eventType: "HEARTBEAT" }; delete h.stationId; delete h.lineId; assert.equal(validateEvent(h).ok, true);
});
test("oversized payload rejected", () => { assert.equal(validateEvent({ ...good(), eventId: "a".repeat(9000) }).ok, false); });
