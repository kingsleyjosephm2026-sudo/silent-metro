# Security notes and threat model (local demo)

This is a demo. Controls below are implemented and covered by automated tests unless marked otherwise. It is not "fully secure".

| Threat | Control | Tested | Remaining risk |
|---|---|---|---|
| Spoofed sensor events | Per-device API key (SHA-256 hashed in memory); payload `deviceId` must match the key | yes | Keys are bearer secrets; use TLS and rotate |
| Unauthorized/unknown device | Registry allowlist; `unassigned_station` check | yes | |
| Stolen device credentials | Operator **revoke** takes effect immediately; critical alert | yes | No automatic key rotation |
| Replay / duplicates | Per-device `eventId` idempotency; per-boot sequence; old-boot replay rejected; max event age 30 s | yes | Replay within 30 s of a *new* eventId needs the key |
| Malformed payloads | Strict validator, size caps (8 KB), no value echo, raw invalid payload not stored | yes | |
| Privilege escalation | Server-side role checks; passenger gets 403 on operator routes; denied attempts audited | yes | |
| CSRF | SameSite=Strict, session-bound `X-CSRF-Token` on all mutations | yes | |
| Session theft | HttpOnly cookie, 30 min idle / 8 h absolute expiry, `Secure` over HTTPS | partly (cookie flags, expiry) | In-memory sessions; no MFA |
| Brute force | 5 failed logins -> 60 s lockout per IP+user; scrypt hashing; timing-equalised unknown-user path | yes | Per-IP key; no global throttle |
| Excessive requests | 120 events/min/device; SSE cap 200; body caps | yes (device limit) | No general HTTP rate limit; use a reverse proxy |
| XSS / injection | DOM built with text nodes, no innerHTML; CSP `script-src 'self'`, no inline script/style; HTML escaping on `/qr` pages; CSV formula neutralisation | yes (QR escaping, CSV, browser CSP check) | |
| Path traversal | Static files resolved and confined to `public/` | yes | |
| QR tampering | QR holds only a URL with a validated slug; resolved server-side; withdrawable | yes | Physical QR stickers can be replaced; verify the station name on screen |
| Data exposure | Passenger API exposes no devices, events, audit or analytics; audit log excludes secrets | yes | |
| Stale/incorrect data | Freshness flag, offline detection, DEMO labels, no ETAs | yes | |

## Not covered
No TLS termination, no database encryption, no backup automation, no penetration test, no dependency scan (there are no dependencies). Back up `data/db.json` by copying it while the server is stopped. Retention is capped by count (2000 events, 500 audit entries); add time-based retention before any real deployment. The server must not be connected to railway signalling, dispatch, or train control.
