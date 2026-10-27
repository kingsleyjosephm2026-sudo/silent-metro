import fs from "node:fs";
import path from "node:path";
import { stations } from "./stations.js";

export function defaultDb() {
  const all = stations.map((s) => s.stationId);
  return {
    version: 2,
    nextRecordId: 1,
    state: { lines: {} },
    devices: {
      "esp32-demo-01": { type: "ESP32", assignedStations: all, revoked: false, lastSeen: null, lastSequence: -1, bootId: null, knownBoots: [], offlineAlerted: false },
      "sim-01": { type: "SIMULATOR", assignedStations: all, revoked: false, lastSeen: null, lastSequence: -1, bootId: null, knownBoots: [], offlineAlerted: false }
    },
    events: [], notifications: [], alerts: [], announcements: [], audit: [], qrRevoked: [], users: {}
  };
}

/** JSON-file persistence (single process demo). Atomic write via temp file + rename. */
export class Store {
  constructor(file) {
    this.file = file;
    this.db = this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
        return { ...defaultDb(), ...parsed, devices: { ...defaultDb().devices, ...(parsed.devices || {}) } };
      }
    } catch {
      try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    }
    return defaultDb();
  }
  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }
}
