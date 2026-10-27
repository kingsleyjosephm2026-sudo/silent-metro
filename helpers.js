import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";

export class ManualClock {
  constructor(t = Date.parse("2026-10-27T10:00:00.000Z")) { this.t = t; }
  now() { return this.t; }
  advance(ms) { this.t += ms; }
}
export const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sm-")), "db.json");

export async function startApp(opts = {}) {
  const clock = opts.clock || new ManualClock();
  const dataFile = opts.dataFile || tmpFile();
  const app = createApp({ dataFile, clock, autoTick: false, env: { SM_DEVICE_KEYS: "esp32-demo-01:test-key-123", ...(opts.env || {}) }, ...opts.appOptions });
  const addr = await app.listen(0, "127.0.0.1");
  return { app, clock, dataFile, base: `http://127.0.0.1:${addr.port}` };
}

/** Tiny cookie-jar client. */
export class Client {
  constructor(base) { this.base = base; this.cookie = ""; this.csrf = null; }
  async req(method, url, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.csrf && method !== "GET") h["x-csrf-token"] = this.csrf;
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await fetch(this.base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (k === "sm_session") this.cookie = v ? `${k}=${v}` : ""; }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(u, h) { return this.req("GET", u, undefined, h); }
  post(u, b = {}, h) { return this.req("POST", u, b, h); }
  async login(username, password) { const r = await this.post("/api/login", { username, password }); if (r.status === 200) this.csrf = r.data.csrfToken; return r; }
}

export const loginOperator = async (base) => { const c = new Client(base); const r = await c.login("operator", "operator-demo"); if (r.status !== 200) throw new Error("operator login failed"); return c; };

export const mkEvent = (clock, over = {}) => ({
  schemaVersion: 1, eventId: `e-${Math.random().toString(36).slice(2, 10)}`, deviceId: "esp32-demo-01", bootId: "boot1",
  lineId: "blue", stationId: "north-gate", eventType: "ARRIVAL", sequence: 0, deviceTimestamp: new Date(clock.now()).toISOString(), source: "ESP32", ...over
});
