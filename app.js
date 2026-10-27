import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { EventService } from "./event-service.js";
import { Simulator, INJECTIONS } from "./simulator.js";
import { lines, stations, qrPoints, resolveQrPoint, planJourney, stationById, POINT_ID_RE, CATALOGUE_LABEL } from "./stations.js";
import { buildUsers, checkLogin, SessionManager, RateLimiter } from "./auth.js";
import { eventsToCsv } from "./analytics.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function createApp(options = {}) {
  const env = options.env || process.env;
  const clock = options.clock || { now: () => Date.now() };
  const secureCookies = options.secureCookies ?? env.SM_SECURE_COOKIES === "1";
  const store = new Store(options.dataFile || env.DATA_FILE || path.join(ROOT, "data", "db.json"));
  const streams = new Set();
  let broadcastTimer = null;
  const broadcast = () => {
    if (broadcastTimer || !streams.size) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      const payload = `data: ${JSON.stringify(service.publicSnapshot())}\n\n`;
      for (const res of streams) { try { res.write(payload); } catch { streams.delete(res); } }
    }, options.broadcastDelayMs ?? 50);
    broadcastTimer.unref?.();
  };
  const service = new EventService(store, broadcast, { clock, config: options.config });
  const simulator = new Simulator(service, store, { clock });
  const { users, defaults: defaultAccounts } = buildUsers(env);
  const sessions = new SessionManager({ clock });
  const loginLimiter = new RateLimiter({ max: 5, windowMs: 60000, lockMs: 60000, clock });
  const deviceLimiter = new RateLimiter({ max: options.deviceRatePerMin ?? 120, windowMs: 60000, clock });

  // Device API keys: SM_DEVICE_KEYS="deviceId:key,deviceId2:key2". Only SHA-256 hashes are kept in memory.
  const deviceKeys = new Map();
  let defaultDeviceKey = false;
  if (env.SM_DEVICE_KEYS) for (const pair of env.SM_DEVICE_KEYS.split(",")) { const i = pair.indexOf(":"); if (i > 0) deviceKeys.set(sha256(pair.slice(i + 1).trim()), pair.slice(0, i).trim()); }
  else { deviceKeys.set(sha256("demo-device-key-esp32-01"), "esp32-demo-01"); defaultDeviceKey = true; }

  // ---------- helpers ----------
  const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf("="); try { return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; } catch { return [x.slice(0, i), ""]; } }));
  const isHttps = (req) => secureCookies || req.headers["x-forwarded-proto"] === "https";
  const baseHeaders = (req) => ({
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(isHttps(req) ? { "Strict-Transport-Security": "max-age=31536000" } : {})
  });
  const send = (req, res, status, body, headers = {}) => { res.writeHead(status, { ...baseHeaders(req), ...headers }); res.end(body); };
  const json = (req, res, status, obj, headers = {}) => send(req, res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  const readBody = (req) => new Promise((resolve, reject) => {
    const ct = req.headers["content-type"] || "";
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > 8192) { req.resume(); return reject(new Error("body_too_large")); }
    let data = "", size = 0, tooLarge = false;
    req.on("data", (c) => { if (tooLarge) return; size += c.length; if (size > 8192) { tooLarge = true; data = ""; reject(new Error("body_too_large")); return; } data += c; });
    req.on("end", () => { if (tooLarge) return; if (!data) return resolve({}); if (!ct.includes("application/json")) return reject(new Error("unsupported_media_type")); try { resolve(JSON.parse(data)); } catch { reject(new Error("invalid_json")); } });
    req.on("error", reject);
  });
  const bodyError = (req, res, e) => {
    if (e.message === "body_too_large") { res.once("finish", () => req.socket.destroy()); return json(req, res, 413, { error: e.message }, { Connection: "close" }); }
    return json(req, res, e.message === "unsupported_media_type" ? 415 : 400, { error: e.message });
  };
  const sessionOf = (req) => { const sid = cookies(req).sm_session; if (!sid) return null; const s = sessions.get(sid); return s ? { sid, ...s } : null; };
  const ip = (req) => req.socket.remoteAddress || "unknown";
  function requireRole(req, res, role) {
    const s = sessionOf(req);
    if (!s) { json(req, res, 401, { error: "authentication_required" }); return null; }
    if (role && s.role !== role) { service.audit(s.username, "forbidden_access", `${req.method} ${req.url.split("?")[0]}`, "denied"); json(req, res, 403, { error: "forbidden" }); return null; }
    return s;
  }
  const csrfOk = (req, s) => typeof req.headers["x-csrf-token"] === "string" && safeEq(req.headers["x-csrf-token"], s.csrf);
  const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

  function qrPage(req, res, pointId) {
    const r = resolveQrPoint(pointId);
    const revoked = r && store.db.qrRevoked.includes(pointId);
    if (!r || revoked) return send(req, res, r ? 410 : 404, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Silent Metro QR</title><link rel="stylesheet" href="/style.css"></head><body><main class="narrow"><h1>QR code not valid</h1><p>${revoked ? "This QR code has been withdrawn." : "This navigation point is unknown or outdated."} Please ask station staff for help.</p><a class="button" href="/">Open Silent Metro</a></main></body></html>`, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    const s = r.station;
    const feat = Object.entries(s.features).filter(([, v]) => v).map(([k]) => k.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ") || "none confirmed";
    send(req, res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.name)}: Silent Metro</title><link rel="stylesheet" href="/style.css"></head><body><main class="narrow"><p class="eyebrow">DEMO NAVIGATION POINT: verified in demo catalogue</p><h1>${esc(s.name)}</h1><p>${esc(r.point.displayName)}</p><p>Lines: ${s.lineIds.map((l) => esc(l.toUpperCase())).join(", ")}</p><p>${esc(s.platform)}</p><p>Accessibility (demo values, not verified): ${esc(feat)}</p><a class="button" href="/?station=${encodeURIComponent(s.stationId)}#plan">Get directions from here</a><p class="muted">Prototype station catalogue; not official metro data.</p></main></body></html>`, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/(public\/)?/, "");
    const pub = path.join(ROOT, "public"), full = path.resolve(pub, rel);
    const within = path.relative(pub, full);
    if (within.startsWith("..") || path.isAbsolute(within)) return json(req, res, 403, { error: "forbidden" });
    fs.readFile(full, (err, data) => {
      if (err) return send(req, res, 404, "Not found", { "Content-Type": "text/plain" });
      send(req, res, 200, data, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
    });
  }

  // ---------- router ----------
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname, m = req.method;

      if (m === "GET" && p === "/api/health") return json(req, res, 200, { ok: true, mode: "LOCAL_DEMO", officialTransitConnected: false, catalogue: CATALOGUE_LABEL });
      if (m === "GET" && p === "/api/state") return json(req, res, 200, service.publicSnapshot());
      if (m === "GET" && p === "/api/stations") return json(req, res, 200, { stations, lines, provenance: CATALOGUE_LABEL });
      if (m === "GET" && p === "/api/plan") {
        const r = planJourney(url.searchParams.get("from") || "", url.searchParams.get("to") || "");
        return json(req, res, r.ok ? 200 : r.error === "unknown_station" ? 400 : 404, { ...r, provenance: "DEMO_ROUTING_NOT_A_TIMETABLE" });
      }
      if (m === "GET" && p.startsWith("/api/qr/")) {
        let id; try { id = decodeURIComponent(p.slice(8)); } catch { return json(req, res, 400, { resolved: false, error: "bad_request" }); }
        const r = resolveQrPoint(id);
        if (!r) return json(req, res, 404, { resolved: false, error: "unknown_navigation_point" });
        if (store.db.qrRevoked.includes(id)) return json(req, res, 410, { resolved: false, error: "revoked_navigation_point" });
        return json(req, res, 200, { resolved: true, pointId: id, point: r.point, station: r.station, provenance: "DEMO_CATALOG" });
      }
      if (m === "GET" && p.startsWith("/qr/")) { let id = ""; try { id = decodeURIComponent(p.slice(4)); } catch { /* invalid */ } return qrPage(req, res, id); }
      if (m === "GET" && p === "/api/stream") {
        if (streams.size >= 200) return json(req, res, 503, { error: "too_many_streams" });
        res.writeHead(200, { ...baseHeaders(req), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(`data: ${JSON.stringify(service.publicSnapshot())}\n\n`);
        streams.add(res); req.on("close", () => streams.delete(res)); return;
      }
      if (m === "GET" && p === "/api/session") {
        const s = sessionOf(req);
        return json(req, res, 200, s ? { authenticated: true, username: s.username, role: s.role, csrfToken: s.csrf, saved: store.db.users[s.username]?.saved ?? [] } : { authenticated: false });
      }

      // --- auth ---
      if (m === "POST" && p === "/api/login") {
        let b; try { b = await readBody(req); } catch (e) { return bodyError(req, res, e); }
        const key = `${ip(req)}|${String(b.username).slice(0, 40)}`;
        const wait = loginLimiter.check(key);
        if (wait) return json(req, res, 429, { error: "too_many_attempts", retryAfterSeconds: wait }, { "Retry-After": String(wait) });
        const u = typeof b.username === "string" && typeof b.password === "string" ? checkLogin(users, b.username, b.password) : null;
        if (!u) { loginLimiter.fail(key); service.audit(String(b.username).slice(0, 40), "login", "session", "failed"); return json(req, res, 401, { error: "invalid_credentials" }); }
        loginLimiter.success(key);
        const { sid, csrf } = sessions.create(b.username, u.role);
        const flags = `Path=/; SameSite=Strict${isHttps(req) ? "; Secure" : ""}`;
        service.audit(b.username, "login", "session");
        return json(req, res, 200, { username: b.username, role: u.role, csrfToken: csrf }, { "Set-Cookie": [`sm_session=${sid}; ${flags}; HttpOnly`] });
      }
      if (m === "POST" && p === "/api/logout") {
        const s = sessionOf(req);
        if (s) { if (!csrfOk(req, s)) return json(req, res, 403, { error: "csrf_check_failed" }); sessions.destroy(s.sid); service.audit(s.username, "logout", "session"); }
        return json(req, res, 200, { ok: true }, { "Set-Cookie": ["sm_session=; Path=/; SameSite=Strict; HttpOnly; Max-Age=0"] });
      }

      // --- device ingestion (API-key auth; no cookies, no CSRF) ---
      if (m === "POST" && p === "/api/events") {
        const auth = req.headers.authorization || "";
        const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        const deviceId = key ? deviceKeys.get(sha256(key)) : null;
        if (!deviceId) { service.audit("unknown-device", "ingest", "/api/events", "denied"); return json(req, res, 401, { error: "device_authentication_required" }, { "WWW-Authenticate": "Bearer" }); }
        if (!deviceLimiter.hit(deviceId)) { service.addAlert("rate_limited", `Device ${deviceId} exceeded the ingestion rate limit`, deviceId, clock.now()); return json(req, res, 429, { error: "rate_limited" }, { "Retry-After": "60" }); }
        let b; try { b = await readBody(req); } catch (e) { return bodyError(req, res, e); }
        const r = service.ingest(b, deviceId);
        const { httpStatus, notification, ...out } = r;
        return json(req, res, httpStatus, out);
      }

      // --- passenger-authenticated ---
      if (p === "/api/me/saved" && m === "POST") {
        const s = requireRole(req, res); if (!s) return;
        if (!csrfOk(req, s)) return json(req, res, 403, { error: "csrf_check_failed" });
        let b; try { b = await readBody(req); } catch (e) { return bodyError(req, res, e); }
        if (!Array.isArray(b.stationIds) || b.stationIds.length > 10 || !b.stationIds.every((x) => typeof x === "string" && stationById(x))) return json(req, res, 422, { error: "invalid_station_ids" });
        store.db.users[s.username] = { ...(store.db.users[s.username] || {}), saved: [...new Set(b.stationIds)] }; store.persist();
        return json(req, res, 200, { saved: store.db.users[s.username].saved });
      }

      // --- operator-only reads ---
      if (m === "GET" && (p.startsWith("/api/operator/") || p === "/api/events" || p === "/api/analytics")) {
        const s = requireRole(req, res, "operator"); if (!s) return;
        if (p === "/api/operator/snapshot") return json(req, res, 200, service.operatorSnapshot());
        if (p === "/api/events" || p === "/api/operator/events") {
          const st = url.searchParams.get("status"), limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
          let ev = store.db.events; if (st) ev = ev.filter((e) => e.status === st);
          return json(req, res, 200, { events: ev.slice(-limit).reverse() });
        }
        if (p === "/api/analytics" || p === "/api/operator/analytics") return json(req, res, 200, service.analytics());
        if (p === "/api/operator/audit") return json(req, res, 200, { audit: store.db.audit.slice(-200).reverse() });
        if (p === "/api/operator/export.json") return json(req, res, 200, { exportedAt: new Date().toISOString(), notice: "May contain SIMULATED (DEMO) data", analytics: service.analytics(), events: store.db.events }, { "Content-Disposition": 'attachment; filename="silent-metro-export.json"' });
        if (p === "/api/operator/export.csv") return send(req, res, 200, eventsToCsv(store.db.events), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="silent-metro-events.csv"', "Cache-Control": "no-store" });
        if (p === "/api/operator/qr") return json(req, res, 200, { points: qrPoints.map((q) => ({ ...q, active: !store.db.qrRevoked.includes(q.pointId), path: `/qr/${q.pointId}` })) });
        return json(req, res, 404, { error: "not_found" });
      }

      // --- operator-only mutations ---
      if (m === "POST" && (p.startsWith("/api/simulator/") || p.startsWith("/api/operator/"))) {
        const s = requireRole(req, res, "operator"); if (!s) return;
        if (!csrfOk(req, s)) { service.audit(s.username, "csrf_failure", p, "denied"); return json(req, res, 403, { error: "csrf_check_failed" }); }
        let b = {}; try { b = await readBody(req); } catch (e) { return bodyError(req, res, e); }
        const done = (action, resource, out) => { service.audit(s.username, action, resource); return json(req, res, 200, out); };
        if (p === "/api/simulator/step") { const r = simulator.step(); service.audit(s.username, "simulator_step", "simulator"); return json(req, res, 200, r); }
        if (p === "/api/simulator/start") { simulator.running = true; return done("simulator_start", "simulator", { running: true }); }
        if (p === "/api/simulator/stop") { simulator.running = false; return done("simulator_stop", "simulator", { running: false }); }
        if (p === "/api/simulator/reset") { simulator.running = false; return done("simulator_reset", "simulator", simulator.reset()); }
        if (p === "/api/simulator/inject") {
          if (!INJECTIONS.includes(b.kind)) return json(req, res, 422, { error: "unknown_injection", allowed: INJECTIONS });
          const r = simulator.inject(b.kind); service.audit(s.username, `simulator_inject:${b.kind}`, "simulator"); return json(req, res, 200, r);
        }
        if (p === "/api/operator/device/revoke" || p === "/api/operator/device/restore") {
          const d = typeof b.deviceId === "string" ? store.db.devices[b.deviceId] : null;
          if (!d) return json(req, res, 404, { error: "unknown_device" });
          d.revoked = p.endsWith("revoke"); store.persist(); broadcast();
          return done(d.revoked ? "device_revoke" : "device_restore", b.deviceId, { deviceId: b.deviceId, revoked: d.revoked });
        }
        if (p === "/api/operator/announcement") {
          const message = cleanText(b.message, 280), severity = ["info", "warning", "critical"].includes(b.severity) ? b.severity : "info";
          const mins = Math.min(240, Math.max(1, Number(b.expiresInMinutes) || 30));
          if (message.length < 3) return json(req, res, 422, { error: "message_too_short" });
          const a = { id: `ann${Date.now()}`, message, severity, status: "active", source: "OPERATOR (DEMO)", publishedAt: new Date(clock.now()).toISOString(), expiresAt: new Date(clock.now() + mins * 60000).toISOString() };
          store.db.announcements.push(a); if (store.db.announcements.length > 50) store.db.announcements.shift(); store.persist(); broadcast();
          return done("announcement_publish", a.id, { announcement: a });
        }
        if (p === "/api/operator/announcement/clear") {
          const a = store.db.announcements.find((x) => x.id === b.id); if (!a) return json(req, res, 404, { error: "unknown_announcement" });
          a.status = "cleared"; store.persist(); broadcast(); return done("announcement_clear", a.id, { cleared: true });
        }
        if (p === "/api/operator/qr/revoke" || p === "/api/operator/qr/restore") {
          if (typeof b.pointId !== "string" || !POINT_ID_RE.test(b.pointId) || !resolveQrPoint(b.pointId)) return json(req, res, 404, { error: "unknown_navigation_point" });
          const set = new Set(store.db.qrRevoked); if (p.endsWith("revoke")) set.add(b.pointId); else set.delete(b.pointId);
          store.db.qrRevoked = [...set]; store.persist();
          return done(p.endsWith("revoke") ? "qr_revoke" : "qr_restore", b.pointId, { pointId: b.pointId, active: !set.has(b.pointId) });
        }
        return json(req, res, 404, { error: "not_found" });
      }

      if (m === "GET") return serveStatic(req, res, p);
      return json(req, res, 405, { error: "method_not_allowed" });
    } catch (e) {
      console.error("request error:", e.message);
      if (!res.headersSent) json(req, res, 500, { error: "internal_error" });
    }
  });

  let timer = null;
  const tickMs = options.tickMs ?? 5000;
  if (options.autoTick !== false) {
    timer = setInterval(() => { try { simulator.tick(); service.checkDevices(); broadcast(); } catch (e) { console.error("tick error:", e.message); } }, tickMs);
    timer.unref();
  }
  if (options.autoStartSimulator ?? env.SM_AUTOSTART_SIM !== "0") if (options.autoTick !== false) simulator.running = true;

  return {
    server, store, service, simulator, sessions, defaultAccounts, defaultDeviceKey,
    listen: (port = Number(env.PORT || 3000), host = env.HOST || "127.0.0.1") => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => { if (timer) clearInterval(timer); if (broadcastTimer) clearTimeout(broadcastTimer); for (const r of streams) { try { r.end(); } catch { /* ignore */ } } streams.clear(); server.closeAllConnections?.(); server.close(() => resolve()); })
  };
}
