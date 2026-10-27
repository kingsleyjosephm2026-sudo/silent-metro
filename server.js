import { createApp } from "./src/app.js";

const app = createApp();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const addr = await app.listen(port, host);
console.log(`Silent Metro local demo: http://localhost:${addr.port}`);
console.log("Mode: LOCAL DEMO. All simulator data is labelled DEMO. No official transit connectivity.");
if (app.defaultAccounts.length) console.warn(`WARNING: using built-in DEMO passwords for: ${app.defaultAccounts.join(", ")}. Set SM_OPERATOR_PASSWORD / SM_PASSENGER_PASSWORD for anything beyond local use.`);
if (app.defaultDeviceKey) console.warn("WARNING: using the built-in DEMO device key. Set SM_DEVICE_KEYS=deviceId:secret for real devices.");
const stop = async () => { await app.close(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
