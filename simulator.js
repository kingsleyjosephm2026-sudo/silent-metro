import { lineById } from "./stations.js";
import { advance, dirAfterArrival, initialLineState } from "./state-machine.js";

export const SIM_DEVICE_ID = "sim-01";
export const INJECTIONS = ["duplicate", "delayed", "out-of-order", "skip", "invalid", "restart", "sensor-fault", "heartbeat"];

/**
 * DEMO simulator. Sends the same event protocol as the ESP32 through the same ingest path.
 * Always sends source "SIMULATOR". It does not represent any real vehicle.
 */
export class Simulator {
  constructor(service, store, options = {}) {
    this.service = service; this.store = store;
    this.clock = options.clock || { now: () => Date.now() };
    this.lineId = options.lineId || "blue";
    this.line = lineById(this.lineId);
    this.running = false;
    this.seq = 0;
    this.boot = `sim${this.clock.now().toString(36)}`;
    this.last = null;
    const st = store.db.state.lines[this.lineId];
    this.idx = st && st.stationId ? this.line.stationIds.indexOf(st.stationId) : null;
    this.dir = st && st.stationId ? st.direction : 1;
  }
  set running(v) { this._running = !!v; if (this.service) { this.service.simulatorRunning = this._running; this.service.onChange(); } }
  get running() { return this._running; }

  reset() {
    this.idx = null; this.dir = 1; this.seq = 0; this.last = null; this.boot = `sim${this.clock.now().toString(36)}r${Math.floor(Math.random() * 1e4)}`;
    this.store.db.state.lines[this.lineId] = initialLineState(this.lineId);
    this.store.persist(); this.service.onChange();
    return { reset: true };
  }
  tick() { return this.running ? this.step() : null; }
  step() { this.moveOne(); return this.send(this.arrival(this.clock.now())); }

  moveOne() {
    if (this.idx === null) { this.idx = 0; this.dir = dirAfterArrival(this.line, 0, 1); }
    else { const n = advance(this.line, this.idx, this.dir); this.idx = n.idx; this.dir = n.dir; }
  }
  make(eventType, stationId, ts, withLine = true) {
    const seq = this.seq++;
    const e = { schemaVersion: 1, eventId: `${SIM_DEVICE_ID}-${this.boot}-${seq}`, deviceId: SIM_DEVICE_ID, bootId: this.boot, eventType, sequence: seq, deviceTimestamp: new Date(ts).toISOString(), source: "SIMULATOR" };
    if (stationId) { e.stationId = stationId; if (withLine) e.lineId = this.lineId; }
    return e;
  }
  arrival(ts) { const e = this.make("ARRIVAL", this.line.stationIds[this.idx], ts); this.last = e; return e; }
  send(raw) { const r = this.service.ingest(raw, SIM_DEVICE_ID); return { ...r, sent: raw && raw.eventId ? { eventId: raw.eventId, eventType: raw.eventType, stationId: raw.stationId ?? null } : null }; }

  inject(kind) {
    const now = this.clock.now();
    switch (kind) {
      case "duplicate": return this.last ? this.send({ ...this.last }) : { error: "nothing_to_duplicate_yet" };
      case "delayed": this.moveOne(); return this.send(this.arrival(now - 120000));
      case "out-of-order": {
        if (this.seq < 2 || this.idx === null) return { error: "need_at_least_two_events_first" };
        const e = this.make("ARRIVAL", this.line.stationIds[this.idx], now); e.sequence = this.seq - 3; e.eventId = `${SIM_DEVICE_ID}-${this.boot}-ooo${this.seq}`;
        return this.send(e);
      }
      case "skip": this.moveOne(); this.moveOne(); return this.send(this.arrival(now));
      case "invalid": return this.send({ schemaVersion: 1, eventId: "bad", deviceId: SIM_DEVICE_ID, eventType: "ARRIVAL", deviceTimestamp: "yesterday" });
      case "restart": this.seq = 0; this.boot = `sim${now.toString(36)}b${Math.floor(Math.random() * 1e4)}`; return this.send(this.make("HEARTBEAT", undefined, now));
      case "sensor-fault": return this.send(this.make("SENSOR_FAULT", this.line.stationIds[this.idx ?? 0], now));
      case "heartbeat": return this.send(this.make("HEARTBEAT", undefined, now));
      default: return { error: "unknown_injection", allowed: INJECTIONS };
    }
  }
}
