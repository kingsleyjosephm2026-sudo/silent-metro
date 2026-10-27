// DEMO CATALOGUE ONLY: fictional stations and lines. Not official metro data.
// Accessibility attributes are demonstration values, NOT verified facts.
export const CATALOGUE_LABEL = "DEMO_CATALOG";

export const lines = [
  { lineId: "blue", name: "Blue Line (demo)", mode: "linear", stationIds: ["north-gate", "market-square", "central", "riverside", "harbour-view", "east-terminal"] },
  { lineId: "green", name: "Green Line (demo)", mode: "linear", stationIds: ["central", "tech-park", "lakeside", "airport-link"] }
];

const f = (stepFree, lift, tactilePaving, audio) => ({ stepFree, lift, tactilePaving, audioAnnouncements: audio });

export const stations = [
  { stationId: "north-gate", name: "North Gate", lineIds: ["blue"], features: f(true, true, true, true), platform: "Platform 1 (demo)", exits: ["Exit A: North Gate Road"] },
  { stationId: "market-square", name: "Market Square", lineIds: ["blue"], features: f(true, true, true, true), platform: "Platform 1 (demo)", exits: ["Exit A: Market Street", "Exit B: Bus Bay"] },
  { stationId: "central", name: "Central", lineIds: ["blue", "green"], features: f(true, true, true, true), platform: "Platform 1 Blue, Platform 2 Green (demo)", exits: ["Exit A: Main Concourse", "Exit B: Civic Plaza"] },
  { stationId: "riverside", name: "Riverside", lineIds: ["blue"], features: f(true, true, false, true), platform: "Platform 1 (demo)", exits: ["Exit A: Riverside Walk"] },
  { stationId: "harbour-view", name: "Harbour View", lineIds: ["blue"], features: f(true, false, true, true), platform: "Platform 1 (demo)", exits: ["Exit A: Harbour Road"] },
  { stationId: "east-terminal", name: "East Terminal", lineIds: ["blue"], features: f(true, true, true, true), platform: "Platform 1 (demo)", exits: ["Exit A: Terminal Forecourt"] },
  { stationId: "tech-park", name: "Tech Park", lineIds: ["green"], features: f(true, true, true, true), platform: "Platform 1 (demo)", exits: ["Exit A: Tech Park Gate 2"] },
  { stationId: "lakeside", name: "Lakeside", lineIds: ["green"], features: f(true, true, false, true), platform: "Platform 1 (demo)", exits: ["Exit A: Lake Road"] },
  { stationId: "airport-link", name: "Airport Link", lineIds: ["green"], features: f(true, true, true, true), platform: "Platform 1 (demo)", exits: ["Exit A: Airport Shuttle"] }
];

// QR navigation points. A QR code encodes only a stable, non-sensitive URL: /qr/<pointId>
export const qrPoints = [
  ...stations.map((s) => ({ pointId: `${s.stationId}-entrance`, stationId: s.stationId, pointType: "entrance", displayName: `${s.name}: main entrance` })),
  { pointId: "central-platform-1", stationId: "central", pointType: "platform", displayName: "Central: Platform 1 (Blue)" },
  { pointId: "central-platform-2", stationId: "central", pointType: "platform", displayName: "Central: Platform 2 (Green)" }
];

const stationMap = new Map(stations.map((s) => [s.stationId, s]));
const lineMap = new Map(lines.map((l) => [l.lineId, l]));
export const stationById = (id) => stationMap.get(id) || null;
export const lineById = (id) => lineMap.get(id) || null;
export const POINT_ID_RE = /^[a-z0-9-]{1,48}$/;

export function resolveQrPoint(pointId) {
  if (typeof pointId !== "string" || !POINT_ID_RE.test(pointId)) return null;
  const point = qrPoints.find((p) => p.pointId === pointId);
  if (!point) return null;
  return { point, station: stationMap.get(point.stationId) };
}

/** Back-compat helper used by server.js: station (plus the point) for a pointId. */
export function stationByPointId(pointId) {
  const r = resolveQrPoint(pointId);
  return r ? { ...r.station, pointId: r.point.pointId, pointType: r.point.pointType, displayName: r.point.displayName, accessible: r.station.features.stepFree } : null;
}

/** Journey planner: Dijkstra over (station, line) states; 1 per stop, 5 per line change. */
export function planJourney(fromId, toId) {
  const from = stationMap.get(fromId), to = stationMap.get(toId);
  if (!from || !to) return { ok: false, error: "unknown_station" };
  if (fromId === toId) return { ok: true, steps: [], totalStops: 0, transfers: 0, text: [`You are already at ${from.name}.`] };
  const key = (s, l) => `${s}|${l}`;
  const dist = new Map(), prev = new Map(), queue = [];
  for (const l of from.lineIds) { dist.set(key(fromId, l), 0); queue.push([0, fromId, l]); }
  let goal = null;
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, s, l] = queue.shift();
    if (d > (dist.get(key(s, l)) ?? Infinity)) continue;
    if (s === toId) { goal = key(s, l); break; }
    const ids = lineMap.get(l).stationIds, i = ids.indexOf(s);
    const relax = (ns, nl, cost) => {
      const nd = d + cost, k = key(ns, nl);
      if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); prev.set(k, key(s, l)); queue.push([nd, ns, nl]); }
    };
    if (i > 0) relax(ids[i - 1], l, 1);
    if (i < ids.length - 1) relax(ids[i + 1], l, 1);
    for (const ol of stationMap.get(s).lineIds) if (ol !== l) relax(s, ol, 5);
  }
  if (!goal) return { ok: false, error: "no_route" };
  const path = [];
  for (let k = goal; k; k = prev.get(k)) path.unshift(k.split("|"));
  const steps = [];
  for (const [s, l] of path) {
    const last = steps[steps.length - 1];
    if (last && last.lineId === l) { last.to = s; last.stops += 1; }
    else if (last && last.to === s) steps.push({ lineId: l, from: s, to: s, stops: 0 });
    else steps.push({ lineId: l, from: s, to: s, stops: 0 });
  }
  const legs = steps.filter((x) => x.stops > 0);
  for (const leg of legs) {
    const ids = lineMap.get(leg.lineId).stationIds;
    const dir = ids.indexOf(leg.to) > ids.indexOf(leg.from) ? ids[ids.length - 1] : ids[0];
    leg.towards = stationMap.get(dir).name;
  }
  const text = legs.map((leg, i) => `${i === 0 ? "Board" : "Change to"} the ${lineMap.get(leg.lineId).name} towards ${leg.towards} at ${stationMap.get(leg.from).name}. Ride ${leg.stops} stop${leg.stops === 1 ? "" : "s"} to ${stationMap.get(leg.to).name}.`);
  text.push(`Arrive at ${to.name}. Demonstration route, not official timetable data.`);
  return { ok: true, steps: legs, totalStops: legs.reduce((a, x) => a + x.stops, 0), transfers: Math.max(0, legs.length - 1), text };
}
