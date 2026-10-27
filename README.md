# Silent Metro: Complete Local Demo

A runnable, local-first prototype of an accessible metro passenger-information platform: browser UI, API server, persistent event log, simulator, strict event validation, duplicate protection, live station state, accessibility alerts, QR navigation, role-based operator tools, analytics, tests, and a documented hardware protocol.

> **This is a demo/prototype.** It is not connected to any metro operator, train control, signalling, or production passenger system. All simulator data is labelled **DEMO**. The station catalogue is fictional and its accessibility values are not verified.

## Requirements
Node.js 18+ (22 LTS recommended). **No npm packages, no paid services, no credentials.**

## Run (Windows)
1. Extract the ZIP, open the `silent-metro-complete` folder.
2. Click the File Explorer address bar, type `cmd`, press Enter.
3. Run:
   ```bat
   npm test
   npm start
   ```
4. Open http://localhost:3000. (Or double-click `start-windows.bat`; keep the window open.)

macOS/Linux: same `npm test` / `npm start`.

`npm run demo` prints a scripted walkthrough of the whole pipeline in the terminal (no server needed).

## Demo accounts (local use only)
| Role | Username | Password |
|---|---|---|
| Passenger | `passenger` | `passenger-demo` |
| Operator | `operator` | `operator-demo` |

Open the **Operator** tab to sign in. Override with `SM_OPERATOR_PASSWORD` / `SM_PASSENGER_PASSWORD`. The server prints a warning while defaults are in use.

## Try it in 2 minutes
1. Sign in as operator, press **Step** a few times (or **Start** for automatic 5-second steps).
2. Open **Journey**: the station state, next station, DEMO label and freshness update live; the announcement is shown, announced to screen readers, and (if enabled in **Accessibility**) spoken and vibrated.
3. In the operator console use **Inject test conditions** (duplicate, delayed, out-of-order, skip, invalid, restart, sensor-fault) and watch the pipeline flag each one without corrupting state.
4. Stop stepping for a while: the line turns **STALE** and the simulator device goes **offline**.
5. **QR** tab: enter `central-platform-1` and press Look up. **Plan** tab: North Gate → Lakeside shows an interchange route.

## Features (all verified by tests, see "Verification")
- **Passenger:** live journey view per line, next station, data-source label (DEMO / prototype hardware), freshness and stale warnings, connection status with polling fallback, service announcement banners, notification centre, journey planner with spoken directions, station directory with search, saved destinations (passenger login), cached station info when offline.
- **Accessibility:** text size, high contrast, reduced motion, spoken announcements (Web Speech API, language and speed selectable), vibration (feature-detected), quiet mode, announcement cooldown, repeat-last-announcement, ARIA live regions, skip link, visible focus, 44 px targets, labelled controls, keyboard operable.
- **QR:** `/qr/<pointId>` pages and `/api/qr/<pointId>`; strict ID validation; operator can withdraw/restore points; withdrawn or unknown codes handled gracefully; optional in-browser camera scan where `BarcodeDetector` exists.
- **Operator console:** simulator controls, device table (online/offline/revoked, last seen, sequence), revoke/restore with confirmation, alerts with explanations, analytics, event history with filter, CSV/JSON export, announcements, QR management, audit log.
- **Pipeline:** schema validation, authenticated device identity, registry and revocation, idempotency, timestamp/age checks, per-boot sequence checks, topology and station-assignment checks, state machine with guarded resync, persistence in `data/db.json`, retention caps, rate limiting.
- **Security:** see `docs/SECURITY.md`.

## Project layout
```
server.js              entry point
src/app.js             HTTP server, routes, security headers, SSE
src/event-service.js   ingestion pipeline, device status, snapshots
src/state-machine.js   pure station-transition logic
src/validator.js       protocol v1 validator
src/simulator.js       DEMO simulator + anomaly injectors
src/auth.js            scrypt passwords, sessions, rate limiter
src/stations.js        DEMO catalogue, QR points, journey planner
src/analytics.js       analytics + CSV export
src/store.js           JSON persistence (atomic write)
public/                passenger + operator UI (no framework, no inline scripts)
tests/                 65 tests (node:test)
scripts/demo.js        terminal walkthrough
scripts/e2e.cjs        optional browser end-to-end check (needs Playwright)
firmware/              UNTESTED ESP32 reference sketch
docs/                  HARDWARE.md, SECURITY.md
```

## Configuration (environment variables)
See `.env.example`. The app reads `process.env` directly (no dotenv).

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Default `3000` and `127.0.0.1`. Use `HOST=0.0.0.0` only when an ESP32 on your LAN must reach it. |
| `SM_OPERATOR_PASSWORD`, `SM_PASSENGER_PASSWORD` | Demo account passwords |
| `SM_DEVICE_KEYS` | `deviceId:secret,deviceId2:secret2` device API keys |
| `SM_SECURE_COOKIES` | `1` when behind HTTPS |
| `SM_AUTOSTART_SIM` | `0` to stop the simulator auto-starting |
| `DATA_FILE` | Custom data file path |

## API
Public: `GET /api/health`, `/api/state`, `/api/stations`, `/api/plan?from=&to=`, `/api/qr/:pointId`, `/api/stream` (SSE), `/api/session`; pages `/qr/:pointId`.
Auth: `POST /api/login`, `/api/logout`. Passenger: `POST /api/me/saved`.
Device (API key): `POST /api/events` with `Authorization: Bearer <device key>`.
Operator (session + CSRF header `X-CSRF-Token`): `GET /api/operator/{snapshot,events,analytics,audit,qr,export.json,export.csv}`; `POST /api/simulator/{start,stop,step,reset,inject}`, `/api/operator/device/{revoke,restore}`, `/api/operator/announcement[/clear]`, `/api/operator/qr/{revoke,restore}`.

Changes from the earlier ChatGPT-generated `server.js`: ingestion now uses device API keys instead of a browser session; operator data (devices, events, analytics) is operator-only; sessions expire; logins are rate-limited; CSRF is bound to the session; the server is split into `src/` modules so it can be tested.

## Hardware event protocol
Full details: `docs/HARDWARE.md`. Example:
```json
{"schemaVersion":1,"eventId":"esp32-demo-01-b123-7","deviceId":"esp32-demo-01","bootId":"b123",
 "lineId":"blue","stationId":"central","eventType":"ARRIVAL","sequence":7,
 "deviceTimestamp":"2026-10-27T10:00:00.000Z","source":"ESP32"}
```
```bash
curl -X POST http://localhost:3000/api/events -H "Content-Type: application/json" \
  -H "Authorization: Bearer demo-device-key-esp32-01" -d @event.json
```

## Verification
```bash
npm test                      # 65 tests, no dependencies
node scripts/e2e.cjs          # optional: browser test (npm i -D playwright && npx playwright install chromium)
```
Results at packaging time are listed in the delivery notes. The e2e script drives the real UI (login, simulator, announcements, stale/offline, revoke, QR, planner, settings, keyboard, CSP console check).

## Deployment path
1. Run `npm test` in CI on every change.
2. Put the app behind HTTPS (reverse proxy such as Caddy or nginx), set `SM_SECURE_COOKIES=1`, strong passwords and device keys, and a non-default `DATA_FILE` on persistent storage.
3. Run with a process manager (systemd, PM2, or Docker `node:22-alpine` with `npm start`). Single process only.
4. For multi-user or production use replace JSON storage with a transactional database, replace demo accounts with a managed identity provider, add monitoring, backups, and retention policy (see `docs/SECURITY.md`).
5. Use per-device secrets with TLS on the ESP32 and rotate them. Obtain written authorization before importing any official transit data.

## Known limitations
- Single-process JSON persistence; not for concurrent production load.
- Demo users are built in; sessions are in memory (restart signs everyone out).
- No QR **image** generation (use any trusted QR tool on the URLs shown in the operator console).
- No Firebase, push notifications, SMS, official feeds, ML models, or real-time vehicle prediction. Web push is not available; delivery to a device is never confirmed.
- Speech and vibration depend on browser support (many iPhones do not support vibration). Camera QR scanning needs `BarcodeDetector` and HTTPS or localhost.
- Accessibility was checked with automated and manual-style tests only; **no formal WCAG audit** was performed and no certification is claimed.
- The ESP32 sketch and wiring are **not verified on hardware**.
