import { validateEvent } from "./validator.js";
import { lines, stations, lineById, stationById } from "./stations.js";
import { applyArrival, initialLineState, nextStationId, freshness } from "./state-machine.js";
import { buildArrivalNotification, provenanceOf, alertSeverity } from "./notifications.js";
import { computeAnalytics } from "./analytics.js";

export const DEFAULT_CONFIG = {
  maxEventAgeMs: 30000, maxClockSkewMs: 5000, resyncAfter: 2, staleAfterMs: 300000,
  deviceOfflineAfterMs: 60000, notificationCooldownMs: 10000,
  maxEvents: 2000, maxNotifications: 100, maxAlerts: 200, maxAudit: 500
};
const COARSE = { accepted: "accepted", duplicate: "duplicate", repeat_detection: "duplicate", invalid_schema: "rejected", device_mismatch: "rejected", unknown_device: "rejected", revoked_device: "rejected" };
const HTTP = { accepted: 202, duplicate: 200, invalid_schema: 422, device_mismatch: 403, unknown_device: 403, revoked_device: 403 };
const SEQ_ADVANCED = new Set(["accepted", "repeat_detection", "unexpected_transition", "unassigned_station", "unknown_line_or_station"]);

/**
 * Trusted ingestion pipeline. `authDeviceId` must come from real device authentication
 * (API key), never from the payload. Simulator and hardware share this exact code path.
 */
export class EventService {
  constructor(store, onChange = () => {}, options = {}) {
    this.store = store;
    this.onChange = onChange;
    this.clock = options.clock || { now: () => Date.now() };
    this.cfg = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    this.simulatorRunning = false; // set by the simulator, shown to passengers
    this.gates = new Map();
    this.rebuildSeen();
  }
  get db() { return this.store.db; }
  rebuildSeen() { this.seen = new Set(this.db.events.filter((e) => e.eventId).map((e) => `${e.deviceId}:${e.eventId}`)); }

  gate(key, now) {
    const prev = this.gates.get(key);
    if (prev !== undefined && now - prev < this.cfg.notificationCooldownMs) return false;
    this.gates.set(key, now);
    return true;
  }

  commit() { this.store.persist(); this.onChange(); }

  addAlert(code, reason, deviceId, now) {
    const severity = alertSeverity(code);
    if (!severity || !this.gate(`alert:${deviceId}:${code}`, now)) return null;
    const alert = { id: `a${this.db.nextRecordId}-${now}`, at: new Date(now).toISOString(), severity, code, title: `Event flagged: ${code.replace(/_/g, " ")}`, explanation: `${reason}. Authoritative station state was NOT changed by this event.`, deviceId };
    if (code === "device_offline") { alert.title = "Device offline"; alert.explanation = reason; }
    this.db.alerts.push(alert);
    if (this.db.alerts.length > this.cfg.maxAlerts) this.db.alerts.splice(0, this.db.alerts.length - this.cfg.maxAlerts);
    return alert;
  }

  audit(actor, action, resource, result = "ok") {
    this.db.audit.push({ at: new Date(this.clock.now()).toISOString(), actor, action, resource, result });
    if (this.db.audit.length > this.cfg.maxAudit) this.db.audit.splice(0, this.db.audit.length - this.cfg.maxAudit);
    this.store.persist();
  }

  ingest(raw, authDeviceId) {
    const now = this.clock.now();
    const finish = (code, reason, event, extra = {}) => {
      const rec = {
        id: this.db.nextRecordId++, receivedAt: new Date(now).toISOString(), deviceId: authDeviceId,
        eventId: event?.eventId ?? null, bootId: event?.bootId ?? null, eventType: event?.eventType ?? null,
        lineId: event?.lineId ?? null, stationId: event?.stationId ?? null, sequence: event?.sequence ?? null,
        deviceTimestamp: event?.deviceTimestamp ?? null, source: event?.source ?? null,
        provenance: event ? provenanceOf(event.source) : null,
        status: COARSE[code] ?? "flagged", validation: code, applied: !!extra.applied, reason,
        ...(extra.errors ? { errors: extra.errors } : {})
      };
      this.db.events.push(rec);
      if (this.db.events.length > this.cfg.maxEvents) { this.db.events.splice(0, this.db.events.length - this.cfg.maxEvents); this.rebuildSeen(); }
      this.addAlert(extra.alertCode ?? code, reason, authDeviceId, now);
      this.commit();
      return { accepted: code === "accepted", status: rec.status, code, applied: rec.applied, reason, recordId: rec.id, httpStatus: HTTP[code] ?? (code === "accepted" ? 202 : 422), notification: extra.notification ?? null, ...(extra.errors ? { errors: extra.errors } : {}) };
    };

    const v = validateEvent(raw);
    if (!v.ok) return finish("invalid_schema", "payload failed schema validation", null, { errors: v.errors });
    const ev = v.event;
    if (ev.deviceId !== authDeviceId) return finish("device_mismatch", "payload deviceId does not match authenticated device", ev);
    const dev = this.db.devices[authDeviceId];
    if (!dev) return finish("unknown_device", "device is not registered", ev);
    if (dev.revoked) return finish("revoked_device", "device credentials are revoked", ev);

    dev.lastSeen = now; // authenticated device is alive even if the event is later flagged
    if (dev.offlineAlerted) { dev.offlineAlerted = false; this.audit("system", "device_recovered", authDeviceId); }

    const key = `${ev.deviceId}:${ev.eventId}`;
    if (this.seen.has(key)) return finish("duplicate", "eventId already processed", ev);
    this.seen.add(key);

    const observedAt = Date.parse(ev.deviceTimestamp);
    if (observedAt > now + this.cfg.maxClockSkewMs) return finish("future_timestamp", "deviceTimestamp is ahead of server time beyond allowed skew", ev);
    if (now - observedAt > this.cfg.maxEventAgeMs) return finish("stale", "event is older than the maximum accepted age (kept for analytics, not applied)", ev);

    if (dev.bootId !== ev.bootId) {
      if (dev.knownBoots.includes(ev.bootId)) return finish("out_of_order", "event belongs to a previous boot session", ev);
      dev.bootId = ev.bootId; dev.knownBoots.push(ev.bootId); if (dev.knownBoots.length > 20) dev.knownBoots.shift(); dev.lastSequence = -1;
    } else if (ev.sequence <= dev.lastSequence) {
      return finish("out_of_order", "sequence is not greater than the last accepted", ev);
    }
    dev.lastSequence = ev.sequence;

    if (ev.eventType === "HEARTBEAT") return finish("accepted", "heartbeat recorded", ev);
    if (ev.eventType === "SENSOR_FAULT") return finish("accepted", `sensor fault reported at ${ev.stationId}`, ev, { alertCode: "sensor_fault" });

    const line = lineById(ev.lineId);
    if (!line || !line.stationIds.includes(ev.stationId) || !stationById(ev.stationId)) return finish("unknown_line_or_station", "line or station is unknown or not on the line", ev);
    if (!dev.assignedStations.includes(ev.stationId)) return finish("unassigned_station", "device is not assigned to this station", ev);

    const prev = this.db.state.lines[line.lineId] || initialLineState(line.lineId);
    if (prev.stationId !== null && observedAt < prev.lastObservedAt) return finish("out_of_order", "event is older than the last applied event on this line", ev);

    const res = applyArrival(prev, line, { stationId: ev.stationId, observedAt, receivedAt: now, eventId: ev.eventId, source: ev.source }, { resyncAfter: this.cfg.resyncAfter });
    if (res.kind === "repeat") return finish("repeat_detection", res.reason, ev);
    if (res.kind === "unexpected") { this.db.state.lines[line.lineId] = res.state; return finish("unexpected_transition", res.reason, ev); }
    this.db.state.lines[line.lineId] = res.state;
    let notification = null;
    if (this.gate(`n:${line.lineId}:${ev.stationId}`, now)) {
      notification = buildArrivalNotification({ line, lineState: res.state, source: ev.source, now: new Date(now).toISOString(), id: `n${this.db.nextRecordId}` });
      this.db.notifications.push(notification);
      if (this.db.notifications.length > this.cfg.maxNotifications) this.db.notifications.splice(0, this.db.notifications.length - this.cfg.maxNotifications);
    }
    return finish("accepted", res.reason, ev, { applied: true, notification });
  }

  /** Mark devices offline (operator alert once per outage). Call periodically. */
  checkDevices(now = this.clock.now()) {
    let changed = false;
    for (const [id, d] of Object.entries(this.db.devices)) {
      if (d.lastSeen && !d.offlineAlerted && now - d.lastSeen > this.cfg.deviceOfflineAfterMs) {
        d.offlineAlerted = true;
        this.addAlert("device_offline", `No event or heartbeat from ${id} for over ${Math.round(this.cfg.deviceOfflineAfterMs / 1000)} seconds`, id, now);
        changed = true;
      }
    }
    if (changed) this.commit();
    return changed;
  }

  deviceViews(now = this.clock.now()) {
    return Object.entries(this.db.devices).map(([deviceId, d]) => ({
      deviceId, type: d.type, revoked: d.revoked, lastSequence: d.lastSequence, bootId: d.bootId,
      lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : null,
      connection: d.revoked ? "revoked" : !d.lastSeen ? "never_seen" : now - d.lastSeen > this.cfg.deviceOfflineAfterMs ? "offline" : "online"
    }));
  }

  lineViews(now = this.clock.now()) {
    return lines.map((l) => {
      const s = this.db.state.lines[l.lineId];
      const fresh = freshness(s, now, this.cfg.staleAfterMs);
      return {
        lineId: l.lineId, name: l.name, stationIds: l.stationIds,
        state: s && s.stationId ? { stationId: s.stationId, nextStationId: nextStationId(l, s), direction: s.direction, updatedAt: new Date(s.updatedAt).toISOString(), ageSeconds: Math.round((now - s.updatedAt) / 1000), source: s.source, provenance: provenanceOf(s.source) } : null,
        freshness: fresh
      };
    });
  }

  activeAnnouncements(now = this.clock.now()) {
    return this.db.announcements.filter((a) => a.status === "active" && Date.parse(a.expiresAt) > now).slice(-5).reverse();
  }

  publicSnapshot(now = this.clock.now()) {
    const devs = this.deviceViews(now);
    return {
      mode: "LOCAL_DEMO", officialTransitConnected: false, serverTime: new Date(now).toISOString(),
      simulatorRunning: this.simulatorRunning, lines: this.lineViews(now),
      notifications: this.db.notifications.slice(-15).reverse(),
      announcements: this.activeAnnouncements(now),
      deviceSummary: { online: devs.filter((d) => d.connection === "online").length, total: devs.length }
    };
  }

  analytics(now = this.clock.now()) { return computeAnalytics(this.db.events, this.deviceViews(now), now); }

  operatorSnapshot(now = this.clock.now()) {
    return {
      ...this.publicSnapshot(now), devices: this.deviceViews(now), alerts: this.db.alerts.slice(-40).reverse(),
      events: this.db.events.slice(-60).reverse(), analytics: this.analytics(now),
      qrRevoked: this.db.qrRevoked, audit: this.db.audit.slice(-40).reverse(), thresholds: { staleAfterMs: this.cfg.staleAfterMs, deviceOfflineAfterMs: this.cfg.deviceOfflineAfterMs }
    };
  }
}
