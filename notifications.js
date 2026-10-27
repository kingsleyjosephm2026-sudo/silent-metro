import { stationById } from "./stations.js";
import { nextStationId } from "./state-machine.js";

export const provenanceOf = (source) => (source === "SIMULATOR" ? "DEMO" : "PROTOTYPE_HARDWARE");

export function buildArrivalNotification({ line, lineState, source, now, id }) {
  const stationId = lineState.stationId;
  const name = stationById(stationId)?.name ?? stationId;
  const nextId = nextStationId(line, lineState);
  const nextName = nextId ? stationById(nextId)?.name ?? nextId : null;
  const idx = line.stationIds.indexOf(stationId);
  const terminal = idx === 0 || idx === line.stationIds.length - 1;
  const demo = source === "SIMULATOR";
  const tail = nextName ? ` Next station: ${nextName}.` : "";
  const term = terminal ? " Terminal station." : "";
  return {
    id, at: now, kind: "arrival", lineId: line.lineId, stationId, priority: terminal ? "high" : "normal",
    title: `Arrived: ${name}`,
    text: `${demo ? "[DEMO] " : ""}Arrived at ${name}.${term}${tail}`,
    speech: `${demo ? "Demonstration. " : ""}Arrived at ${name}.${term}${tail}`,
    vibration: terminal ? [400, 150, 400, 150, 400] : [200, 100, 200],
    provenance: provenanceOf(source)
  };
}

const SEVERITY = {
  device_mismatch: "critical", revoked_device: "critical", unknown_device: "critical", device_offline: "warning",
  unexpected_transition: "warning", out_of_order: "warning", stale: "warning", future_timestamp: "warning",
  unassigned_station: "warning", unknown_line_or_station: "warning", invalid_schema: "warning", sensor_fault: "warning", rate_limited: "warning"
};
export const alertSeverity = (code) => SEVERITY[code] ?? null;
