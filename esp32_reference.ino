/*
 * Silent Metro: ESP32 REFERENCE SKETCH (UNTESTED ON HARDWARE)
 * ---------------------------------------------------------------------------------
 * This is a protocol reference, NOT your verified firmware. It was not compiled or run
 * against a real board by the author. Adapt it to your existing firmware.
 *
 *  - GPIO numbers below are PLACEHOLDERS. Set them to match YOUR wiring and keep your
 *    existing pin assignments. Never copy pins from here into a working circuit blindly.
 *  - Uses plain HTTP for LAN demos. For anything beyond a local demo use HTTPS
 *    (WiFiClientSecure) and keep the API key out of source control.
 *  - Requires Arduino-ESP32 core. JSON is built by hand to avoid extra libraries.
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* SERVER_URL = "http://192.168.1.50:3000/api/events";   // server must run with HOST=0.0.0.0
const char* DEVICE_ID  = "esp32-demo-01";
const char* DEVICE_KEY = "demo-device-key-esp32-01";                // change via SM_DEVICE_KEYS on the server
const char* LINE_ID    = "blue";

// PLACEHOLDER: one IR sensor per station, in line order. Replace with your real wiring.
const int NUM_STATIONS = 6;
const int IR_PINS[NUM_STATIONS] = {32, 33, 25, 26, 27, 14};
const char* STATION_IDS[NUM_STATIONS] = {"north-gate", "market-square", "central", "riverside", "harbour-view", "east-terminal"};

const unsigned long DEBOUNCE_MS = 400;
const unsigned long HEARTBEAT_MS = 20000;
unsigned long lastTrigger[NUM_STATIONS] = {0};
bool lastState[NUM_STATIONS];
unsigned long lastHeartbeat = 0;
uint32_t sequenceNo = 0;
char bootId[24];

// Tiny queue so events survive short network outages (oldest dropped when full).
const int QMAX = 16;
String queue[QMAX]; int qHead = 0, qCount = 0;
void enqueue(const String& s) { if (qCount == QMAX) { qHead = (qHead + 1) % QMAX; qCount--; } queue[(qHead + qCount) % QMAX] = s; qCount++; }

String isoNow() {
  struct tm t; if (!getLocalTime(&t, 50)) return "";
  char buf[32]; strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t); return String(buf);
}
String makeEvent(const char* type, const char* station) {
  String ts = isoNow(); if (ts == "") return "";   // never send events without a synced clock
  String id = String(DEVICE_ID) + "-" + bootId + "-" + String(sequenceNo);
  String j = "{\"schemaVersion\":1,\"eventId\":\"" + id + "\",\"deviceId\":\"" + DEVICE_ID + "\",\"bootId\":\"" + bootId + "\"";
  if (station) j += String(",\"lineId\":\"") + LINE_ID + "\",\"stationId\":\"" + station + "\"";
  j += String(",\"eventType\":\"") + type + "\",\"sequence\":" + String(sequenceNo) + ",\"deviceTimestamp\":\"" + ts + "\",\"source\":\"ESP32\"}";
  sequenceNo++; return j;
}
bool post(const String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http; http.begin(SERVER_URL); http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_KEY); http.setTimeout(4000);
  int code = http.POST(body); http.end();
  return code == 202 || code == 200;   // 200 = duplicate: server already has it, safe to drop
}
void flush() { while (qCount > 0) { if (!post(queue[qHead])) break; qHead = (qHead + 1) % QMAX; qCount--; } }

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_STATIONS; i++) { pinMode(IR_PINS[i], INPUT); lastState[i] = digitalRead(IR_PINS[i]); }
  snprintf(bootId, sizeof(bootId), "b%lu", (unsigned long)esp_random());   // new value every reboot
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");                      // clock sync is required
}
void loop() {
  if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); delay(1000); }
  unsigned long now = millis();
  for (int i = 0; i < NUM_STATIONS; i++) {
    bool s = digitalRead(IR_PINS[i]);
    // Assumes the sensor output goes LOW when the beam is broken. Check your sensor module.
    if (lastState[i] && !s && now - lastTrigger[i] > DEBOUNCE_MS) {
      lastTrigger[i] = now; String ev = makeEvent("ARRIVAL", STATION_IDS[i]);
      if (ev != "") { if (!post(ev)) enqueue(ev); }
    }
    lastState[i] = s;
  }
  if (now - lastHeartbeat > HEARTBEAT_MS) { lastHeartbeat = now; String ev = makeEvent("HEARTBEAT", nullptr); if (ev != "" && !post(ev)) enqueue(ev); }
  flush(); delay(5);
}
