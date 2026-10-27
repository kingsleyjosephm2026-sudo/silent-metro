import { test } from "node:test";
import assert from "node:assert/strict";
import { applyArrival, initialLineState, nextStationId, freshness } from "../src/state-machine.js";
import { lineById } from "../src/stations.js";

const blue = lineById("blue");
const arr = (stationId, t = 1) => ({ stationId, observedAt: t, receivedAt: t, eventId: `e${t}`, source: "SIMULATOR" });
function run(ids) { let s = initialLineState("blue"), t = 1; for (const id of ids) { const r = applyArrival(s, blue, arr(id, t++)); assert.equal(r.kind, "applied", `${id}: ${r.reason}`); s = r.state; } return s; }

test("first arrival sets position and derives next", () => { const s = run(["north-gate"]); assert.equal(nextStationId(blue, s), "market-square"); });
test("walks to terminal and reverses", () => {
  const s = run(["north-gate", "market-square", "central", "riverside", "harbour-view", "east-terminal", "harbour-view"]);
  assert.equal(nextStationId(blue, s), "riverside");
});
test("repeat detection leaves state unchanged", () => { const s = run(["north-gate", "market-square"]); assert.equal(applyArrival(s, blue, arr("market-square", 9)).kind, "repeat"); });
test("skipped and backwards stations are flagged", () => {
  const s = run(["north-gate", "market-square"]);
  const r = applyArrival(s, blue, arr("riverside", 9));
  assert.equal(r.kind, "unexpected"); assert.equal(r.state.stationId, "market-square");
  assert.equal(applyArrival(s, blue, arr("north-gate", 9)).kind, "unexpected");
});
test("resync only after consistent repeated detections", () => {
  let s = run(["north-gate", "market-square"]);
  const a = applyArrival(s, blue, arr("riverside", 10)); assert.equal(a.kind, "unexpected"); s = a.state;
  const b = applyArrival(s, blue, arr("riverside", 11)); assert.equal(b.kind, "applied"); assert.equal(b.state.stationId, "riverside");
});
test("pending counter resets when a different station appears", () => {
  let s = run(["north-gate", "market-square"]);
  s = applyArrival(s, blue, arr("riverside", 10)).state;
  const r = applyArrival(s, blue, arr("harbour-view", 11)); assert.equal(r.kind, "unexpected"); assert.equal(r.state.pending.count, 1);
});
test("freshness states", () => {
  assert.equal(freshness(undefined, 5000, 1000), "unknown");
  const s = run(["north-gate"]);
  assert.equal(freshness(s, 500, 1000), "fresh"); assert.equal(freshness(s, 5000, 1000), "stale");
});
