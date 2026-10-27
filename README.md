# SILENT METRO 🇮🇳
### Making Metro Mobility More Accessible, Independent, and Inclusive

**An accessibility-first smart mobility platform designed to help passengers navigate metro systems with greater independence, confidence, and safety.**

Silent Metro combines real-time-style station information, accessible journey planning, QR-based navigation, multimodal alerts, device-event validation, and an operator monitoring console in a local-first prototype designed for future adaptation to metro networks across India.

> **Our vision:** Make accessible metro information easier to deliver, understand, and use—regardless of a passenger's visual, hearing, or mobility limitations.

**Status:** Working local prototype  
**Deployment:** Local demo; no official metro integration  
**Architecture:** Modular Node.js backend, browser-based frontend, persistent event store, event simulator, and documented hardware protocol

---

## 🚇 The Problem

Public transportation information is not equally accessible to everyone.

- Visually impaired passengers may struggle to access visual-only station and journey information.
- Deaf and hard-of-hearing passengers may miss audio-only announcements.
- Passengers with mobility limitations may need better access to verified station facilities and route information.
- Operators need reliable visibility into device health, event quality, stale information, and passenger-facing announcements.

Silent Metro explores how an inclusive software platform can address these challenges through a unified, accessibility-first experience.

## 💡 The Solution

Silent Metro brings passenger navigation, accessible notifications, event processing, and operational monitoring into one prototype.

### Passenger Experience
- Live-updating station and journey information.
- Journey planning with interchange support.
- Station directory, search, and saved destinations.
- QR-based station-point lookup.
- Visual announcements and accessible notification history.
- Optional spoken announcements and vibration alerts.
- High-contrast mode, adjustable text size, reduced motion, and keyboard navigation.
- Stale-data indicators and cached station information when offline.

### Operator Experience
- Simulator controls and fault injection.
- Device status monitoring and device revocation.
- Event history with filtering and CSV/JSON exports.
- Operational alerts, analytics, and audit logging.
- Announcement management and QR-point administration.
- Visibility into duplicate, delayed, invalid, and out-of-order events.

### Reliable Event Processing
The event pipeline validates incoming data, authenticates configured devices, rejects duplicates, checks timestamps and sequence numbers, evaluates station transitions, and persists accepted events and state.

Invalid or suspicious events are flagged instead of silently changing authoritative station state.

## ♿ Accessibility by Design

Accessibility is a core engineering requirement, not a decorative feature.

- Screen-reader announcements and ARIA live regions.
- Semantic controls, visible keyboard focus, and a skip link.
- Adjustable typography and high-contrast presentation.
- Reduced-motion support.
- Optional speech and vibration, subject to browser and device capabilities.
- Clear DEMO labels, freshness warnings, and offline indicators.

**Important:** The prototype has not undergone a formal WCAG audit. Station accessibility information is fictional or unverified and must not be treated as real-world accessibility guidance.

## 🧠 Engineering Highlights

- **Modular backend:** Separated application, authentication, event processing, station logic, analytics, simulator, validation, and persistence modules.
- **Event integrity:** Strict schema validation, duplicate protection, timestamp checks, per-boot sequencing, and guarded station-state transitions.
- **Security controls:** Password hashing, session expiry, login rate limiting, role-based access, CSRF protection, device API keys, and security headers.
- **Persistent state:** JSON-backed storage with atomic-write handling and retention limits.
- **Live updates:** Server-sent events with polling fallback.
- **Testability:** Automated Node.js tests and an optional browser end-to-end test.
- **Hardware integration path:** A documented ESP32 event protocol for future verified hardware integration.

## 🏙️ Designed for India's Metro Future

Silent Metro is designed with a potential path toward adaptation across metro networks in India, including systems in Bengaluru, Delhi, Mumbai, Chennai, Hyderabad, Kochi, and other cities.

The long-term concept is a reusable accessibility layer that could integrate with authorized station data, verified facility information, operator systems, and suitable IoT devices.

Potential future capabilities include:
- Multilingual announcements and journey assistance.
- Verified lift, ramp, and accessible-route information.
- Station-specific QR navigation.
- Authorized real-time service information.
- Privacy-conscious passenger feedback.
- Offline-first assistance for unreliable connectivity.
- Integration adapters for different metro operators.

These are proposed expansion opportunities, not claims of existing deployment or integration.

## 🛠️ Technology Stack

- **Backend:** Node.js, native HTTP APIs
- **Frontend:** HTML, CSS, JavaScript
- **Data:** Persistent JSON event and state storage
- **Communication:** REST APIs, server-sent events
- **Security:** Password hashing, sessions, role checks, CSRF controls, device API keys
- **Testing:** Node.js built-in test runner; optional Playwright-based browser testing
- **Hardware pathway:** ESP32 reference firmware and documented event protocol

The core demo does not require npm package installation, paid services, or external API credentials.

## ⚡ Run Locally

**Requirements:** Node.js 18 or newer; Node.js 22 LTS is recommended.

1. Download and extract the project.
2. Open a terminal inside the `silent-metro-complete` directory.
3. Run the tests:

   `npm test`

4. Start the application:

   `npm start`

5. Open `http://localhost:3000`.

To run the scripted terminal walkthrough:

`npm run demo`

### Local demo accounts

| Role | Username | Password |
|---|---|---|
| Passenger | `passenger` | `passenger-demo` |
| Operator | `operator` | `operator-demo` |

These are development credentials only. Configure stronger passwords before any network-accessible deployment.

## 🧪 Testing and Verification

The supplied delivery notes report 65 automated tests passing and a successful headless-browser test at packaging time.

Re-run `npm test` against the current repository to verify its present state. The optional end-to-end test requires Playwright and Chromium.

Real ESP32 hardware, physical wiring, camera scanning on a phone, production security, and formal accessibility compliance have not been verified.

## 🗺️ Roadmap

**Phase 1 — Working prototype**
- [x] Passenger and operator interfaces
- [x] Event validation and duplicate protection
- [x] Station-state simulation and persistence
- [x] Accessibility controls and announcements
- [x] QR lookup, analytics, and event exports

**Phase 2 — Stronger accessibility and data quality**
- [ ] Multilingual passenger assistance
- [ ] Verified station accessibility database
- [ ] More comprehensive offline journey guidance
- [ ] Automated accessibility checks and external usability testing

**Phase 3 — Hardware and integration**
- [ ] Compile and test ESP32 firmware against verified wiring
- [ ] Integrate authenticated devices over an appropriately secured network
- [ ] Add a production-grade transactional database
- [ ] Integrate authorized metro data sources

**Phase 4 — Pilot and measurable impact**
- [ ] Conduct user research with disabled passengers
- [ ] Partner with a metro operator for a controlled pilot
- [ ] Measure journey completion, information accessibility, and alert reliability
- [ ] Evaluate expansion to additional metro networks

## 🔐 Safety, Privacy, and Security

Silent Metro is an educational and engineering prototype, not a certified passenger-safety system. It is not connected to metro signalling, train control, or official transit feeds.

Before deployment, the project needs a production-grade database, managed identity, secure secret management, monitoring, backup and recovery procedures, privacy review, hardware verification, and formal security and accessibility assessments.

See `docs/SECURITY.md` and `docs/HARDWARE.md`.

## 🌟 Why Silent Metro Matters

Accessibility should be built into the systems people depend on every day.

Silent Metro explores how inclusive design, reliable event processing, security, and IoT-ready architecture can come together to improve the passenger-information experience.

**Built as a working prototype. Designed with a larger vision: more inclusive mobility across India.**

---

Created as an accessibility-focused engineering project. Contributions, accessibility feedback, and technical collaboration are welcome.
