export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** Derived purely from stored event records. */
export function computeAnalytics(events, deviceViews, now, bucketMs = 60000) {
  const total = events.length, byCode = {}, byStation = {}, buckets = new Map(), lat = [];
  let simulated = false, hardware = false, flagged = 0, rejected = 0;
  for (const e of events) {
    byCode[e.validation] = (byCode[e.validation] || 0) + 1;
    if (e.status === "flagged") flagged++;
    if (e.status === "rejected") rejected++;
    if (e.source === "SIMULATOR") simulated = true; else if (e.source === "ESP32") hardware = true;
    if (e.status === "accepted" && e.deviceTimestamp) { const l = Date.parse(e.receivedAt) - Date.parse(e.deviceTimestamp); if (Number.isFinite(l)) lat.push(l); }
    if (e.applied && e.stationId) {
      byStation[e.stationId] = (byStation[e.stationId] || 0) + 1;
      const b = Math.floor(Date.parse(e.receivedAt) / bucketMs) * bucketMs;
      buckets.set(b, (buckets.get(b) || 0) + 1);
    }
  }
  lat.sort((a, b) => a - b);
  const dup = byCode.duplicate || 0, rate = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const online = deviceViews.filter((d) => d.connection === "online").length;
  return {
    provenance: "DERIVED_FROM_STORED_EVENTS", generatedAt: new Date(now).toISOString(),
    totalEvents: total, accepted: events.filter((e) => e.status === "accepted").length,
    duplicates: events.filter((e) => e.status === "duplicate").length, flagged, rejected,
    duplicateRate: rate(dup), flaggedRate: rate(flagged), rejectedRate: rate(rejected),
    byCode, arrivalsByStation: byStation,
    arrivalsByInterval: [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(-12).map(([t, count]) => ({ bucketStart: new Date(t).toISOString(), count })),
    latencyMs: lat.length ? { count: lat.length, p50: percentile(lat, 50), p95: percentile(lat, 95), max: lat[lat.length - 1] } : null,
    averageLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
    devicesOnline: online, devicesTotal: deviceViews.length,
    containsSimulatedData: simulated, containsHardwareData: hardware,
    notes: [...(simulated ? ["Contains SIMULATED (DEMO) events: not real operational measurements."] : []), "Latency depends on device clock accuracy."]
  };
}

const cell = (v) => { let s = v === undefined || v === null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function eventsToCsv(events) {
  const cols = ["id", "receivedAt", "deviceTimestamp", "deviceId", "source", "provenance", "eventType", "lineId", "stationId", "sequence", "status", "validation", "applied", "reason"];
  return [cols.join(","), ...events.map((e) => cols.map((c) => cell(e[c])).join(","))].join("\n") + "\n";
}
