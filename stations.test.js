import { test } from "node:test";
import assert from "node:assert/strict";
import { planJourney, resolveQrPoint, stationByPointId, qrPoints, stations } from "../src/stations.js";

test("QR resolution returns the verified station", () => {
  const r = resolveQrPoint("central-platform-2"); assert.equal(r.station.name, "Central"); assert.equal(r.point.pointType, "platform");
  assert.equal(stationByPointId("north-gate-entrance").stationId, "north-gate");
});
test("QR resolution rejects unknown and malformed identifiers", () => {
  for (const id of ["nope", "../etc/passwd", "A B", "", null, undefined, "x".repeat(100), "<script>"]) assert.equal(resolveQrPoint(id), null, String(id));
});
test("every QR point maps to a real station", () => { for (const q of qrPoints) assert.ok(stations.find((s) => s.stationId === q.stationId)); });
test("planner: same line", () => {
  const r = planJourney("north-gate", "riverside"); assert.equal(r.ok, true); assert.equal(r.transfers, 0); assert.equal(r.totalStops, 3);
  assert.match(r.text[0], /towards East Terminal/);
});
test("planner: interchange at Central", () => {
  const r = planJourney("north-gate", "lakeside"); assert.equal(r.ok, true); assert.equal(r.transfers, 1);
  assert.equal(r.steps[0].to, "central"); assert.equal(r.steps[1].lineId, "green");
});
test("planner: same station and unknown station", () => {
  assert.equal(planJourney("central", "central").totalStops, 0);
  assert.equal(planJourney("central", "atlantis").ok, false);
});
