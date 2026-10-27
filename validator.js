// Device event protocol v1 validator. Strict: exact required fields, unknown fields rejected,
// bounded payload, and error messages never echo attacker-supplied values.
export const MAX_PAYLOAD_CHARS = 8192;
export const EVENT_TYPES = ["ARRIVAL", "HEARTBEAT", "SENSOR_FAULT"];
export const SOURCES = ["ESP32", "SIMULATOR"];
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SLUG_RE = /^[a-z0-9-]{1,48}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const ALLOWED = new Set(["schemaVersion", "eventId", "deviceId", "bootId", "lineId", "stationId", "eventType", "sequence", "deviceTimestamp", "source"]);

export function validateEvent(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: ["payload must be a JSON object"] };
  let size;
  try { size = JSON.stringify(raw).length; } catch { return { ok: false, errors: ["payload is not serializable"] }; }
  const errors = [];
  if (size > MAX_PAYLOAD_CHARS) errors.push("payload too large");
  for (const k of Object.keys(raw)) if (!ALLOWED.has(k)) errors.push(`unknown field: ${k.slice(0, 32)}`);
  if (raw.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  for (const f of ["eventId", "deviceId"]) if (typeof raw[f] !== "string" || !ID_RE.test(raw[f])) errors.push(`${f} must match [A-Za-z0-9._:-]{1,64}`);
  if (raw.bootId !== undefined && (typeof raw.bootId !== "string" || !ID_RE.test(raw.bootId))) errors.push("bootId invalid");
  if (!EVENT_TYPES.includes(raw.eventType)) errors.push("eventType invalid");
  if (!SOURCES.includes(raw.source)) errors.push("source invalid");
  if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 0) errors.push("sequence must be a non-negative integer");
  if (typeof raw.deviceTimestamp !== "string" || !ISO_RE.test(raw.deviceTimestamp) || !Number.isFinite(Date.parse(raw.deviceTimestamp))) errors.push("deviceTimestamp must be an ISO 8601 date-time");
  for (const f of ["lineId", "stationId"]) if (raw[f] !== undefined && (typeof raw[f] !== "string" || !SLUG_RE.test(raw[f]))) errors.push(`${f} invalid`);
  if ((raw.eventType === "ARRIVAL" || raw.eventType === "SENSOR_FAULT") && (raw.lineId === undefined || raw.stationId === undefined)) errors.push(`${raw.eventType} requires lineId and stationId`);
  if (errors.length) return { ok: false, errors };
  const event = { schemaVersion: 1, eventId: raw.eventId, deviceId: raw.deviceId, bootId: raw.bootId ?? "boot0", eventType: raw.eventType, sequence: raw.sequence, deviceTimestamp: raw.deviceTimestamp, source: raw.source };
  if (raw.lineId !== undefined) event.lineId = raw.lineId;
  if (raw.stationId !== undefined) event.stationId = raw.stationId;
  return { ok: true, event };
}
