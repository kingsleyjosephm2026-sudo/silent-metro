import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, Client, loginOperator, mkEvent } from "./helpers.js";

const ctx = await startApp();
const { base, clock, app } = ctx;
after(() => app.close());
const KEY = { authorization: "Bearer test-key-123" };
let seq = 0;
const devEvent = (over = {}) => mkEvent(clock, { sequence: seq++, bootId: "apiboot", ...over });

test("health reports local demo and no official connectivity", async () => {
  const r = await new Client(base).get("/api/health");
  assert.equal(r.status, 200); assert.equal(r.data.officialTransitConnected, false); assert.equal(r.data.mode, "LOCAL_DEMO");
});
test("security headers are set", async () => {
  const r = await new Client(base).get("/api/health");
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.equal(r.headers.get("x-frame-options"), "DENY");
});
test("public snapshot exposes no device, event, audit or analytics detail", async () => {
  const r = await new Client(base).get("/api/state");
  assert.equal(r.status, 200);
  for (const k of ["devices", "events", "audit", "analytics", "alerts"]) assert.equal(k in r.data, false, k);
  assert.equal(r.data.officialTransitConnected, false);
});
test("operator reads require an operator session", async () => {
  const anon = new Client(base);
  for (const u of ["/api/operator/snapshot", "/api/events", "/api/analytics", "/api/operator/audit", "/api/operator/export.csv", "/api/operator/qr"]) assert.equal((await anon.get(u)).status, 401, u);
  const pax = new Client(base); assert.equal((await pax.login("passenger", "passenger-demo")).status, 200);
  for (const u of ["/api/operator/snapshot", "/api/events", "/api/operator/audit"]) assert.equal((await pax.get(u)).status, 403, u);
  const op = await loginOperator(base);
  assert.equal((await op.get("/api/operator/snapshot")).status, 200);
});
test("passenger cannot run simulator or admin actions; operator can", async () => {
  const pax = new Client(base); await pax.login("passenger", "passenger-demo");
  for (const u of ["/api/simulator/step", "/api/simulator/start", "/api/operator/device/revoke", "/api/operator/announcement"]) assert.equal((await pax.post(u, {})).status, 403, u);
  const op = await loginOperator(base);
  const r = await op.post("/api/simulator/step"); assert.equal(r.status, 200); assert.equal(r.data.sent.eventType, "ARRIVAL");
});
test("anonymous cannot call protected mutations", async () => {
  assert.equal((await new Client(base).post("/api/simulator/step")).status, 401);
});
test("CSRF token is required for session mutations", async () => {
  const op = await loginOperator(base);
  const saved = op.csrf; op.csrf = null;
  assert.equal((await op.post("/api/simulator/step")).status, 403);
  op.csrf = "wrong-token"; assert.equal((await op.post("/api/simulator/step")).status, 403);
  op.csrf = saved; assert.equal((await op.post("/api/simulator/step")).status, 200);
});
test("login: bad credentials 401, then lockout 429; success clears", async () => {
  const c = new Client(base);
  for (let i = 0; i < 5; i++) assert.equal((await c.post("/api/login", { username: "operator", password: "nope" })).status, 401);
  const locked = await c.post("/api/login", { username: "operator", password: "operator-demo" });
  assert.equal(locked.status, 429); assert.ok(locked.headers.get("retry-after"));
  clock.advance(61000);
  assert.equal((await c.post("/api/login", { username: "operator", password: "operator-demo" })).status, 200);
});
test("login rejects malformed bodies and unknown users", async () => {
  const c = new Client(base);
  assert.equal((await c.post("/api/login", { username: "ghost", password: "x" })).status, 401);
  assert.equal((await c.post("/api/login", { username: { a: 1 }, password: 5 })).status, 401);
  assert.equal((await c.post("/api/login", { username: "__proto__", password: "x" })).status, 401);
});
test("session cookie is HttpOnly + SameSite=Strict; logout invalidates it", async () => {
  const c = new Client(base);
  const r = await c.login("operator", "operator-demo");
  const sc = r.headers.getSetCookie().join(";");
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  assert.equal((await c.get("/api/session")).data.authenticated, true);
  const cookie = c.cookie;
  assert.equal((await c.post("/api/logout")).status, 200);
  const stale = new Client(base); stale.cookie = cookie;
  assert.equal((await stale.get("/api/operator/snapshot")).status, 401);
});
test("sessions expire after inactivity", async () => {
  const c = await loginOperator(base);
  assert.equal((await c.get("/api/operator/snapshot")).status, 200);
  clock.advance(31 * 60000);
  assert.equal((await c.get("/api/operator/snapshot")).status, 401);
});

test("device ingestion requires a valid API key", async () => {
  const c = new Client(base);
  assert.equal((await c.post("/api/events", devEvent())).status, 401);
  assert.equal((await c.post("/api/events", devEvent(), { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await c.post("/api/events", devEvent(), { authorization: "Basic abc" })).status, 401);
});
test("a logged-in operator session alone cannot ingest device events", async () => {
  const op = await loginOperator(base);
  assert.equal((await op.post("/api/events", devEvent())).status, 401);
});
test("valid device event is accepted, applied, then duplicate is idempotent", async () => {
  app.simulator.reset();
  const c = new Client(base); const e = devEvent({ stationId: "north-gate" });
  const a = await c.post("/api/events", e, KEY); assert.equal(a.status, 202); assert.equal(a.data.accepted, true); assert.equal(a.data.applied, true);
  const d = await c.post("/api/events", e, KEY); assert.equal(d.status, 200); assert.equal(d.data.status, "duplicate");
  const s = await c.get("/api/state"); const blue = s.data.lines.find((l) => l.lineId === "blue");
  assert.equal(blue.state.stationId, "north-gate"); assert.equal(blue.state.provenance, "PROTOTYPE_HARDWARE"); assert.equal(blue.freshness, "fresh");
  assert.equal(s.data.notifications[0].provenance, "PROTOTYPE_HARDWARE");
});
test("device cannot claim another device's identity", async () => {
  const r = await new Client(base).post("/api/events", devEvent({ deviceId: "sim-01" }), KEY);
  assert.equal(r.status, 403); assert.equal(r.data.code, "device_mismatch");
});
test("invalid, malformed, oversized and wrong-content-type payloads are rejected", async () => {
  const c = new Client(base);
  assert.equal((await c.post("/api/events", { schemaVersion: 1 }, KEY)).status, 422);
  const raw = (body, ct = "application/json") => fetch(base + "/api/events", { method: "POST", headers: { ...KEY, "content-type": ct }, body });
  assert.equal((await raw("{not json")).status, 400);
  assert.equal((await raw("x".repeat(20000))).status, 413);
  assert.equal((await raw(JSON.stringify(devEvent()), "text/plain")).status, 415);
});
test("revoked device is refused (403) and a critical alert is raised; restore works", async () => {
  const op = await loginOperator(base), dev = new Client(base);
  assert.equal((await op.post("/api/operator/device/revoke", { deviceId: "esp32-demo-01" })).status, 200);
  const r = await dev.post("/api/events", devEvent(), KEY); assert.equal(r.status, 403); assert.equal(r.data.code, "revoked_device");
  const snap = (await op.get("/api/operator/snapshot")).data;
  assert.equal(snap.devices.find((d) => d.deviceId === "esp32-demo-01").connection, "revoked");
  assert.ok(snap.alerts.some((a) => a.code === "revoked_device" && a.severity === "critical"));
  assert.equal((await op.post("/api/operator/device/restore", { deviceId: "esp32-demo-01" })).status, 200);
  assert.equal((await dev.post("/api/events", devEvent({ stationId: "market-square" }), KEY)).status, 202);
  assert.equal((await op.post("/api/operator/device/revoke", { deviceId: "ghost" })).status, 404);
});
test("ingestion is rate limited per device", async () => {
  const r = await startApp({ appOptions: { deviceRatePerMin: 3 } });
  const c = new Client(r.base); let last;
  for (let i = 0; i < 5; i++) last = await c.post("/api/events", mkEvent(r.clock, { sequence: i, bootId: "b" }), KEY);
  assert.equal(last.status, 429); await r.app.close();
});

test("QR: resolves, rejects unknown/malformed, honours revocation, escapes output", async () => {
  const c = new Client(base);
  const ok = await c.get("/api/qr/central-platform-1"); assert.equal(ok.status, 200); assert.equal(ok.data.station.name, "Central"); assert.equal(ok.data.provenance, "DEMO_CATALOG");
  assert.equal((await c.get("/api/qr/nope")).status, 404);
  assert.equal((await c.get("/api/qr/%3Cscript%3E")).status, 404);
  assert.equal((await c.get("/api/qr/%E0%A4%A")).status, 400);
  const page = await c.get("/qr/central-platform-1"); assert.equal(page.status, 200); assert.match(page.data, /Central/); assert.match(page.data, /DEMO/);
  const bad = await c.get("/qr/%3Cimg%20src=x%3E"); assert.equal(bad.status, 404); assert.ok(!String(bad.data).includes("<img src=x>"));
  const op = await loginOperator(base);
  assert.equal((await op.post("/api/operator/qr/revoke", { pointId: "central-platform-1" })).status, 200);
  assert.equal((await c.get("/api/qr/central-platform-1")).status, 410); assert.equal((await c.get("/qr/central-platform-1")).status, 410);
  assert.equal((await op.post("/api/operator/qr/restore", { pointId: "central-platform-1" })).status, 200);
  assert.equal((await c.get("/api/qr/central-platform-1")).status, 200);
  assert.equal((await op.post("/api/operator/qr/revoke", { pointId: "../x" })).status, 404);
});
test("journey planner endpoint", async () => {
  const c = new Client(base);
  const r = await c.get("/api/plan?from=north-gate&to=lakeside"); assert.equal(r.status, 200); assert.equal(r.data.transfers, 1); assert.match(r.data.provenance, /NOT_A_TIMETABLE/);
  assert.equal((await c.get("/api/plan?from=x&to=y")).status, 400);
});
test("announcements: validated, shown to passengers, clearable, audited", async () => {
  const op = await loginOperator(base), anon = new Client(base);
  assert.equal((await op.post("/api/operator/announcement", { message: "x" })).status, 422);
  const a = await op.post("/api/operator/announcement", { message: "Delay on Blue Line \u0007 (demo)", severity: "warning", expiresInMinutes: 10 });
  assert.equal(a.status, 200); assert.ok(!a.data.announcement.message.includes("\u0007"));
  assert.ok((await anon.get("/api/state")).data.announcements.some((x) => x.id === a.data.announcement.id));
  await op.post("/api/operator/announcement/clear", { id: a.data.announcement.id });
  assert.ok(!(await anon.get("/api/state")).data.announcements.some((x) => x.id === a.data.announcement.id));
  const audit = (await op.get("/api/operator/audit")).data.audit.map((x) => x.action);
  assert.ok(audit.includes("announcement_publish") && audit.includes("login"));
});
test("audit log records denied access and never contains passwords", async () => {
  const pax = new Client(base); await pax.login("passenger", "passenger-demo"); await pax.get("/api/operator/audit");
  const op = await loginOperator(base); const text = JSON.stringify((await op.get("/api/operator/audit")).data);
  assert.match(text, /forbidden_access/); assert.ok(!text.includes("passenger-demo") && !text.includes("operator-demo"));
});
test("saved destinations: passenger session + CSRF + validation", async () => {
  const pax = new Client(base); await pax.login("passenger", "passenger-demo");
  assert.equal((await pax.post("/api/me/saved", { stationIds: ["central", "lakeside"] })).status, 200);
  assert.deepEqual((await pax.get("/api/session")).data.saved, ["central", "lakeside"]);
  assert.equal((await pax.post("/api/me/saved", { stationIds: ["atlantis"] })).status, 422);
  assert.equal((await new Client(base).post("/api/me/saved", { stationIds: [] })).status, 401);
});
test("exports are operator-only; CSV neutralises formulas and carries DEMO provenance", async () => {
  const op = await loginOperator(base);
  const csv = await op.get("/api/operator/export.csv"); assert.equal(csv.status, 200); assert.match(csv.headers.get("content-type"), /text\/csv/); assert.match(csv.data, /^id,receivedAt/); assert.match(csv.data, /provenance/);
  const j = await op.get("/api/operator/export.json"); assert.equal(j.status, 200); assert.ok(Array.isArray(j.data.events));
});
test("SSE stream sends a snapshot", async () => {
  const ctl = new AbortController();
  const res = await fetch(base + "/api/stream", { signal: ctl.signal });
  assert.equal(res.status, 200); assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const { value } = await res.body.getReader().read(); const text = new TextDecoder().decode(value);
  assert.match(text, /^data: \{/); assert.match(text, /LOCAL_DEMO/); ctl.abort();
});
test("static serving: UI is served and path traversal is blocked", async () => {
  const c = new Client(base);
  const idx = await c.get("/"); assert.equal(idx.status, 200); assert.match(idx.data, /Silent Metro/); assert.match(idx.data, /DEMO/);
  for (const u of ["/server.js", "/public/../server.js", "/%2e%2e%2fserver.js", "/..%2f..%2fpackage.json", "/data/db.json"]) {
    const r = await c.get(u); assert.notEqual(r.status, 200, u); assert.ok(!String(r.data).includes("createApp"), u);
  }
});
