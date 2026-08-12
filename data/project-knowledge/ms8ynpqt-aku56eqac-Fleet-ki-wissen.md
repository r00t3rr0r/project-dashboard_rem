# Projektwissen KI\n\n- Projekt-ID: ms8ynpqt-aku56eqac\n- Projekt: Fleet\n- Repository: https://github.com/mustafaakgl/Fleet\n- Generiert am: 2026-08-12T21:53:04.197466Z\n- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M\n\nHere's a thinking process:

1.  **Analyze User Input:**
   - **Role:** Senior Technical Program Assistant
   - **Task:** Create compact, AI-efficient project knowledge from provided JSON data.
   - **Output Format (Markdown):** Exactly these sections:
     1) Projektkontext
     2) Aktueller technischer Stand
     3) Offene Aufgaben und Luecken
     4) Risiken und Blocker
     5) Naechste 10 voraussichtliche Aufgaben (priorisiert)
     6) Empfohlenes Sprint-Backlog (max. 12 Punkte)
     7) Wissens-Shortcuts fuer Folge-LLM-Prompts (Stichpunkte)
   - **Rules:**
     - Precise German
     - No invented facts, only use input data
     - Mark missing data as "Unbekannt"
     - Formulate actionable for dev teams
   - **Project Data:** JSON containing project info, GitHub metrics/recent commits (218 total, last commit Aug 1, 2026), tasks/releases/events empty, team: Mustafa (Developer). Key themes from commits: Fleet management app, routing optimization (Valhalla, Photon, OR-Tools planned), telematics/tachograph, driver navigation (mobile/Expo), tour planning UI/backend, accounting/invoicing (DATEV export, fatura editor), dashboard/i18n, location model & geocoding, tenant isolation, GoBD compliance, GDPR/location tracking consent.

2.  **Extract Key Information per Section:**

   *1) Projektkontext*
   - Name: Fleet
   - Repo: https://github.com/mustafaakgl/Fleet
   - Status: active
   - Start: 2026-05-22, End: Unbekannt
   - Description: Aus GitHub importiert (Fleet Management / Routing / Telematics App)
   - Team: Mustafa (Developer)
   - Tech Stack hints from commits: TypeScript, Prisma, Valhalla, Photon, Redis/ioredis, BullMQ, Expo Router (mobile), Leaflet, Next.js/frontend, Docker-compose.
   - Focus: Rautenoptimierung, Telematik/Tachograph, Fahrer-App, Buchhaltung/GoBD, Dashboard, Tenant-Isolation.

   *2) Aktueller technischer Stand*
   - Backend: TypeScript/Node.js (implied by tsc, Prisma), Valhalla routing integrated, Photon geocoding with Redis cache, Location model & backfill script done, Tour/TourStop models & optimization service implemented, RoutingModule & Assignment integration complete.
   - Frontend/Mobile: Next.js frontend with i18n (de/en/tr + 10 others), Expo Router mobile app for drivers, Tour screen & navigation links integrated, Dashboard simplified, Einsatzplan tab added, Fatura editor & settings screens done, DATEV export implemented.
   - Telematics/Tachograph: Device offline detection, DDD fixture tests, 561/2006 rule engine (25 specs), location tracking consent applied, DriverLocationHistory fix for silent drops.
   - Compliance/Security: GoBD compliant (invoice locking, snapshots), DSGVO location storage (90d cron), speed limits, file access guards, audit log (164 ops), env.validation.ts as production gate.
   - Metrics: 218 commits, last commit Aug 1, 2026. Production build clean. Tenant isolation verified.

   *3) Offene Aufgaben und Luecken*
   - Telematik ingest: `verify-tacho-telematics` red since Jul 31 14:20; telemetry processed but DriverLocationHistory not written. Separate task tracked.
   - Photo encryption key missing (G1): Photos stored unencrypted, env.validation.ts checks tachograph key but not photo key.
   - Production env template incomplete (G2): 42/153 vars undocumented (encryption keys, ingest tokens).
   - Privacy policy gaps (G3): Missing listed data types (tachograph, driver scoring/profile, telematics, fines, sessions, messages).
   - Location tracking legal basis (G4): "Consent" debatable under German labor law; lawyer review needed.
   - Quarantine flow auto-test missing (G5): T7 still open.
   - Real load test missing (G6): k6-smoke.js only checks existence, no 100+ device pilot behavior known.
   - UI/Nav issues: Accountant can't access billing module from sidebar (B1), fuel card reconciliation page missing from menu (B2).
   - Admin tour planning access limited to `office` role only.
   - DriverLocationHistory.driverId nullable needed for vehicles without tasks/currentDriverId.

   *4) Risiken und Blocker*
   - Telematik ingest pipeline broken silently since Jul 31.
   - Photo encryption key not validated/configured → unencrypted storage in prod.
   - Missing load test behavior for 100+ devices could cause unexpected scaling issues.
   - Legal basis for GPS tracking relies on consent; potential BetrVG/ArbG conflict.
   - Demo data mismatch: Dev map covers NRW only, but tasks are nationwide → deviation report shows 0 km for many vehicles until full Germany tile build (~10GB, ~5h).
   - Single unreachable stop breaks entire tour optimization (400 error) without fallback.

   *5) Naechste 10 voraussichtliche Aufgaben (priorisiert)*
   1. Telematik ingest reparieren & `verify-tacho-telematics` grün bekommen
   2. Foto-Verschlüsselungs-Key validieren & konfigurieren (G1 fixen)
   3. Produktions-Env-Template dokumentieren & fehlende Keys ergänzen (G2)
   4. Datenschutzerklärung um verarbeitete Datenarten erweitern (G3)
   5. GPS-Erfassung Rechtsgrundlage prüfen / Anpassung an §87 BetrVG (G4)
   6. Quarantäne-Automatiktest implementieren & T7 schließen (G5)
   7. Lasttest mit k6 für 100+ Geräte durchführen & Verhalten dokumentieren (G6)
   8. Sidebar-Navigation fixen: Buchhalter → Faturierungsmodule & Tankkarten-Abgleich sichtbar machen (B1, B2\n