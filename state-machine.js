// Pure station-transition logic for a linear line that reverses at its terminals.
export function initialLineState(lineId) {
  return { lineId, stationId: null, direction: 1, lastObservedAt: 0, updatedAt: 0, lastEventId: null, source: null, pending: null };
}

export function dirAfterArrival(line, idx, current) {
  const last = line.stationIds.length - 1;
  if (idx >= last) return -1;
  if (idx <= 0) return 1;
  return current;
}

export function advance(line, idx, dir) {
  const next = idx + dir;
  return { idx: next, dir: dirAfterArrival(line, next, dir) };
}

export function nextStationId(line, state) {
  if (!state || state.stationId === null) return null;
  const idx = line.stationIds.indexOf(state.stationId);
  return idx === -1 ? null : (line.stationIds[idx + state.direction] ?? null);
}

/** Never mutates `state`. Returns {kind:'applied'|'repeat'|'unexpected', ...}. */
export function applyArrival(state, line, a, cfg = { resyncAfter: 2 }) {
  const ids = line.stationIds, idx = ids.indexOf(a.stationId);
  if (idx === -1) return { kind: "unexpected", reason: "station is not on this line", state };
  const make = (dir) => ({ ...state, stationId: a.stationId, direction: dir, lastObservedAt: a.observedAt, updatedAt: a.receivedAt, lastEventId: a.eventId, source: a.source, pending: null });
  if (state.stationId === null) return { kind: "applied", state: make(dirAfterArrival(line, idx, 1)), previousStationId: null, reason: "initial position established" };
  const cur = ids.indexOf(state.stationId);
  if (idx === cur) return { kind: "repeat", reason: "repeated detection of the current station" };
  const expected = cur + state.direction;
  if (idx === expected) return { kind: "applied", state: make(dirAfterArrival(line, idx, state.direction)), previousStationId: state.stationId, reason: "expected next station" };
  const count = state.pending && state.pending.stationId === a.stationId ? state.pending.count + 1 : 1;
  if (count >= Math.max(2, cfg.resyncAfter)) {
    return { kind: "applied", state: make(dirAfterArrival(line, idx, idx > cur ? 1 : -1)), previousStationId: state.stationId, reason: `resynced after ${count} consistent out-of-sequence detections` };
  }
  return { kind: "unexpected", reason: `expected ${ids[expected] ?? "a different station"} but detected ${a.stationId}; state unchanged`, state: { ...state, pending: { stationId: a.stationId, count } } };
}

export function freshness(state, now, staleAfterMs) {
  if (!state || state.stationId === null) return "unknown";
  return now - state.updatedAt > staleAfterMs ? "stale" : "fresh";
}
