/* Optional browser end-to-end check. Requires Playwright + a Chromium build:
 *   npm i -D playwright && npx playwright install chromium && node scripts/e2e.cjs
 * Not part of `npm test` (which needs no dependencies). */
const { chromium } = require("playwright");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const { createApp } = await import("../src/app.js");
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sm-e2e-")), "db.json");
  const app = createApp({ dataFile, tickMs: 500, autoStartSimulator: false, config: { staleAfterMs: 1500, deviceOfflineAfterMs: 1500 }, env: { SM_DEVICE_KEYS: "esp32-demo-01:e2e-key" } });
  const { port } = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());
  const shots = process.env.SHOTS_DIR; if (shots) fs.mkdirSync(shots, { recursive: true });
  const step = (n) => console.log("  ✔", n);

  await page.goto(base);
  assert.match(await page.title(), /Silent Metro/);
  assert.match(await page.locator(".demo-banner").innerText(), /DEMO \/ SIMULATED DATA/);
  await page.waitForSelector("#conn:has-text('Live updates connected')"); step("page loads, DEMO banner shown, SSE connected");
  assert.match(await page.locator("#lines").innerText(), /No data yet/); step("journey shows 'No data yet' before any event");

  // operator login (wrong password first)
  await page.click('a[data-view="operator"]');
  await page.fill("#login-user", "operator"); await page.fill("#login-pass", "wrong");
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector("#login-msg").textContent.includes("failed")); step("bad password rejected with message");
  await page.fill("#login-pass", "operator-demo"); await page.click('#login-form button[type=submit]');
  await page.waitForSelector("#console:not([hidden]) #op-sim-status"); step("operator signs in; console visible");

  // simulator step -> passenger state + accessible announcement
  await page.click('[data-action=sim][data-op=step]');
  await page.click('a[data-view="journey"]');
  await page.waitForSelector("#lines :text('Last detected: North Gate')");
  assert.match(await page.locator("#last-announcement").innerText(), /^\[DEMO\] Arrived at North Gate\. Terminal station\. Next station: Market Square\.$/);
  assert.match(await page.locator("#lines").innerText(), /DEMO: simulated/); step("simulator event updates dashboard, announcement text labelled DEMO");
  await page.waitForTimeout(100);
  assert.ok((await page.locator("#live-assertive").innerText() + await page.locator("#live-polite").innerText()).includes("North Gate")); step("screen-reader live region receives the announcement");
  if (shots) await page.screenshot({ path: path.join(shots, "passenger-journey.png"), fullPage: true });

  // second step with cooldown bypass via settings
  await page.click('a[data-view="operator"]');
  await page.click('[data-action=sim][data-op=step]');
  await page.click('[data-action=inject][data-kind=duplicate]');
  await page.waitForFunction(() => /duplicate/.test(document.querySelector("#op-inject-result").textContent));
  assert.match(await page.locator("#op-inject-result").innerText(), /state NOT changed/); step("duplicate injection is detected and does not change state");
  await page.click('[data-action=inject][data-kind=skip]');
  await page.waitForFunction(() => /unexpected_transition/.test(document.querySelector("#op-inject-result").textContent)); step("skipped station flagged");
  await page.waitForSelector("#op-alerts :text('Event flagged: unexpected transition')"); step("operator alert raised with explanation");
  await page.selectOption("#op-ev-filter", "flagged");
  assert.ok((await page.locator("#op-events tbody tr").count()) >= 1); step("event history filter works");

  // devices: sim online then offline/stale after thresholds; revoke esp32
  await page.waitForSelector("#op-devices :text('online')");
  await page.waitForSelector("#op-devices :text('offline')", { timeout: 8000 }); step("device flips to offline after silence");
  await page.click('a[data-view="journey"]');
  await page.waitForSelector("#lines :text('STALE')", { timeout: 8000 }); step("stale-data indicator appears");
  await page.click('a[data-view="operator"]');
  await page.click('[data-action=revoke][data-device="esp32-demo-01"]');
  await page.waitForSelector("#op-devices :text('revoked')"); step("device revoke (with confirmation) works");
  const res = await fetch(base + "/api/events", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer e2e-key" }, body: JSON.stringify({ schemaVersion: 1, eventId: "x1", deviceId: "esp32-demo-01", lineId: "blue", stationId: "central", eventType: "ARRIVAL", sequence: 0, deviceTimestamp: new Date().toISOString(), source: "ESP32" }) });
  assert.equal(res.status, 403); step("revoked hardware device is refused by the API");

  // announcements
  await page.fill("#ann-msg", "Demo notice: Blue Line works this weekend"); await page.selectOption("#ann-sev", "warning");
  await page.click('#op-ann-form button[type=submit]');
  await page.click('a[data-view="journey"]');
  await page.waitForSelector("#banners :text('Blue Line works this weekend')"); step("operator announcement shows as passenger banner");
  if (shots) await page.screenshot({ path: path.join(shots, "passenger-stale-banner.png"), fullPage: true });

  // QR + plan
  await page.click('a[data-view="qr"]');
  await page.fill("#qr-input", "central-platform-1"); await page.click('#qr-form button[type=submit]');
  await page.waitForSelector("#qr-result :text('Verified in DEMO catalogue')");
  assert.match(await page.locator("#qr-result").innerText(), /Central/); step("QR code resolves to verified station");
  await page.fill("#qr-input", "../../etc/passwd"); await page.click('#qr-form button[type=submit]');
  await page.waitForSelector("#qr-result :text('not a valid')"); step("malformed QR input handled gracefully");
  await page.fill("#qr-input", "central-platform-1"); await page.click('#qr-form button[type=submit]');
  await page.click("text=Get directions from here");
  assert.equal(await page.inputValue("#plan-from"), "central"); step("QR 'directions from here' pre-fills the start station");
  await page.selectOption("#plan-from", "north-gate"); await page.selectOption("#plan-to", "lakeside"); await page.click('#plan-form button[type=submit]');
  await page.waitForSelector("#plan-result :text('Change to')"); step("planner shows an interchange route (Blue → Green)");
  if (shots) await page.screenshot({ path: path.join(shots, "plan.png"), fullPage: true });

  // settings
  await page.click('a[data-view="settings"]');
  await page.check("#set-contrast"); assert.ok(await page.evaluate(() => document.documentElement.classList.contains("hc")));
  await page.click("#text-inc"); assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), "110%");
  await page.reload(); assert.ok(await page.evaluate(() => document.documentElement.classList.contains("hc"))); step("high-contrast and text-size settings apply and persist");
  if (shots) await page.screenshot({ path: path.join(shots, "settings-high-contrast.png"), fullPage: true });
  await page.uncheck("#set-contrast").catch(() => {});

  // keyboard + labelling sanity
  await page.goto(base); await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.className), "skip"); step("first Tab stop is the skip link");
  const unlabeled = await page.evaluate(() => [...document.querySelectorAll("input,select")].filter((el) => !el.labels?.length && !el.getAttribute("aria-label")).map((e) => e.id));
  assert.deepEqual(unlabeled, []); step("all static form controls have labels");

  // passenger cannot see operator data
  await page.click('a[data-view="operator"]'); await page.click("#btn-logout"); await page.waitForSelector("#login-card:not([hidden])");
  assert.equal(await page.locator("#console").isHidden(), true); step("sign out hides operator console");
  if (shots) { await page.fill("#login-user", "operator"); await page.fill("#login-pass", "operator-demo"); await page.click('#login-form button[type=submit]'); await page.waitForSelector("#console:not([hidden]) #op-sim-status"); await page.waitForTimeout(800); await page.screenshot({ path: path.join(shots, "operator-console.png"), fullPage: true }); }

  const real = problems.filter((p) => !/favicon|Failed to load resource.*(401|403)/.test(p));
  assert.deepEqual(real, [], "browser console problems:\n" + real.join("\n")); step("no console errors or CSP violations");
  await browser.close(); await app.close();
  console.log("E2E PASSED");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
