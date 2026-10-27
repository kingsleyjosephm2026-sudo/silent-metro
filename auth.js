import crypto from "node:crypto";

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const key = crypto.scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}
export function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(":");
  const key = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
const DUMMY = hashPassword("dummy-password-for-timing");

export function buildUsers(env = process.env) {
  const defaults = [];
  const mk = (name, role, envName, fallback) => {
    const pw = env[envName] || fallback;
    if (!env[envName]) defaults.push(name);
    return [name, { role, hash: hashPassword(pw) }];
  };
  return { users: Object.fromEntries([mk("passenger", "passenger", "SM_PASSENGER_PASSWORD", "passenger-demo"), mk("operator", "operator", "SM_OPERATOR_PASSWORD", "operator-demo")]), defaults };
}
export function checkLogin(users, username, password) {
  const u = Object.prototype.hasOwnProperty.call(users, username) ? users[username] : null;
  const ok = verifyPassword(password, u ? u.hash : DUMMY); // constant-ish work for unknown users
  return u && ok ? u : null;
}

export class SessionManager {
  constructor({ idleMs = 30 * 60000, absoluteMs = 8 * 3600000, clock = { now: () => Date.now() } } = {}) { this.map = new Map(); this.idleMs = idleMs; this.absoluteMs = absoluteMs; this.clock = clock; }
  create(username, role) {
    const sid = crypto.randomBytes(24).toString("hex"), csrf = crypto.randomBytes(24).toString("hex"), now = this.clock.now();
    this.map.set(sid, { username, role, csrf, createdAt: now, lastSeen: now });
    return { sid, csrf };
  }
  get(sid) {
    const s = this.map.get(sid); if (!s) return null;
    const now = this.clock.now();
    if (now - s.lastSeen > this.idleMs || now - s.createdAt > this.absoluteMs) { this.map.delete(sid); return null; }
    s.lastSeen = now; return s;
  }
  destroy(sid) { this.map.delete(sid); }
}

export class RateLimiter {
  constructor({ max, windowMs, lockMs = windowMs, clock = { now: () => Date.now() } }) { Object.assign(this, { max, windowMs, lockMs, clock }); this.map = new Map(); }
  /** Returns 0 if allowed, else seconds until retry. */
  check(key) { const e = this.map.get(key), now = this.clock.now(); if (e && e.lockedUntil > now) return Math.ceil((e.lockedUntil - now) / 1000); return 0; }
  fail(key) { const now = this.clock.now(); let e = this.map.get(key); if (!e || now - e.first > this.windowMs) e = { count: 0, first: now, lockedUntil: 0 }; e.count++; if (e.count >= this.max) e.lockedUntil = now + this.lockMs; this.map.set(key, e); }
  success(key) { this.map.delete(key); }
  /** Sliding-window hit counter for API throttling: returns true if allowed. */
  hit(key) { const now = this.clock.now(); let e = this.map.get(key); if (!e || now - e.first > this.windowMs) e = { count: 0, first: now, lockedUntil: 0 }; e.count++; this.map.set(key, e); return e.count <= this.max; }
}
