# Hardware event protocol (version 1)

## Transport
`POST /api/events`, `Content-Type: application/json`, `Authorization: Bearer <device key>`. Body max 8 KB. Use HTTPS outside a local demo.
The server derives the device identity from the key. A payload `deviceId` that differs is rejected (`device_mismatch`).

## Payload
| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | 1 | required |
| `eventId` | string `[A-Za-z0-9._:-]{1,64}` | unique per device; retries MUST reuse it |
| `deviceId` | string | must equal the key's device |
| `bootId` | string, optional | new value on every reboot (default `boot0`); lets the sequence restart |
| `eventType` | `ARRIVAL` / `HEARTBEAT` / `SENSOR_FAULT` | |
| `lineId`, `stationId` | slug | required for ARRIVAL and SENSOR_FAULT |
| `sequence` | integer >= 0 | strictly increasing within a `bootId` |
| `deviceTimestamp` | ISO 8601 date-time | needs NTP; server rejects events >5 s in the future or >30 s old |
| `source` | `ESP32` / `SIMULATOR` | |

Unknown fields are rejected. Raw invalid payloads are not stored.

## Responses
| HTTP | `code` | Meaning |
|---|---|---|
| 202 | `accepted` | stored (state changed only if `applied: true`) |
| 200 | `duplicate` / `repeat_detection` | already known; safe to drop from your retry queue |
| 401 | n/a | missing or wrong API key |
| 403 | `device_mismatch`, `unknown_device`, `revoked_device` | identity problem |
| 422 | `invalid_schema`, `out_of_order`, `stale`, `future_timestamp`, `unexpected_transition`, `unassigned_station`, `unknown_line_or_station` | stored and flagged; state NOT changed |
| 413/415/400 | n/a | body too large / not JSON / malformed |
| 429 | n/a | rate limit (120 events/min/device) |

## Device behaviour to implement
- Debounce each IR sensor (reference: 400 ms) and send one ARRIVAL per detection.
- Send a HEARTBEAT every ~20 s; the server marks a device **offline** after 60 s of silence.
- Keep a small retry queue; resend with the **same** `eventId`. Events older than 30 s will be stored but not applied.
- Do not send events until the clock is NTP-synced.
- Keep the API key out of source control.

## State rules
The server applies an ARRIVAL only if it is the expected next station (the line reverses at terminals). Skips, backward jumps, and out-of-order events are flagged and raise an operator alert. If the same unexpected station is detected twice in a row, the server accepts it as a **resync** (covers a missed sensor).

## Wiring
Not defined here. I did not see your circuit, so `firmware/esp32_reference.ino` uses **placeholder pins**. Keep your existing, verified pin assignments. The sketch is untested on hardware.
