# Projektwissen KI\n\n- Projekt-ID: msqfpjcm-pdxeymjzq\n- Projekt: Crypto Trading\n- Repository: https://github.com/r00t3rr0r/tradingng\n- Generiert am: 2026-08-12T21:48:46.185919Z\n- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M\n\nHere's a thinking process:

1.  **Analyze User Input:**
   - **Role:** Senior Technical Program Assistant
   - **Task:** Create a compact, AI-efficient project knowledge document from provided JSON data.
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
     - Formulate for developer teams
   - **Input Data:** JSON containing project info, GitHub metrics/commits, flow/tasks/releases/events, team, knowledge links/env.

2.  **Extract Key Information from JSON:**
   - *Project:* Crypto Trading (Multi-Exchange-Krypto-Trading-System)
   - *Description:* Market-Data-Ingestion, Regime Detection, Signal Fusion, Risk Management, Smart Order Routing, Backtesting, Monitoring und Alerting.
   - *Status:* active
   - *Dates:* Start: 2026-07-19, End: Unbekannt (empty string)
   - *Repo:* https://github.com/r00t3rr0r/tradingng (Note: JSON says `trading` in some URLs but repo name is `tradingng`. I'll stick to the provided URL or note it.)
   - *Language:* Python
   - *Commits:* 71 total, last commit 2026-07-23. Active days last 30: 9. Contributors: 1 (Dieter/1337v). Avg commits/week: 46.1.
   - *Recent Commits Highlights:*
     - Setup instructions (.env, conda, pip)
     - DB connection & env vars loading
     - Admin dashboard (System Status Bar, WebSocket hub, auth, metrics, backtesting UI, audit log, data source management)
     - StrategyService refactoring (Redis handling, fallback profiles, param validation)
     - Integration management & testing (ccxt for exchange connectivity)
     - Risk management (Kelly sizing integration)
     - Candle metrics & persistence (Redis + PostgreSQL)
     - Maintenance features (cache cleanup, Redis mgmt, PG pruning)
     - Task runner (`scripts/tasks.py`) replacing Makefile
     - OKX endpoints updated to EEA production
     - Exchange credential management (passphrase support)
     - Capital management (deployable capital aggregation, effective equity resolution)
   - *Flow/Tasks:* 0 tasks total. Status counts all 0. Done ratio: 0. Rhythm score: 15. Delivery score: 30.
   - *Team:* Dieter (Project Lead). Only member.
   - *Knowledge/Links:* Grafana at http://157.180.38.253:3001/
   - *Env Summary:* 21 keys, samples: PGPASSWORD, DATABASE_URL, REDIS_URL, LEVERAGE_DEFAULT. Secret count: 1. Link count: 1.

3.  **Map to Output Sections:**

   *1) Projektkontext*
   - Title: Crypto Trading
   - Goal: Multi-Exchange-Krypto-Trading-System (Ingestion, Regime Detection, Signal Fusion, Risk Mgmt, Smart Order Routing, Backtesting, Monitoring, Alerting)
   - Status: Active
   - Timeline: Start 2026-07-19, End Unbekannt
   - Team: Dieter (Project Lead), Solo-Entwicklung
   - Repo: Python, GitHub private, 71 Commits, letzte Aktivität 23.07.2026

   *2) Aktueller technischer Stand*
   - Core Architecture: Python-basiert, nutzt Redis für Echtzeit-Daten/State, PostgreSQL für Persistenz (OHLCV/Candles), ccxt für Exchange-Konnektivität.
   - Dashboard & UI: Admin-Dashboard mit WebSocket-Hub, System-Status-Bar, Authentifizierung, Metriken, Backtesting-UI, Audit-Log, Datenquellen-Management.
   - Strategy & Risk: `StrategyService` mit Redis-Verbindungsprüfung, Fallback-Profilen, Parameter-Validierung. Kelly-Criterion für Position Sizing integriert. Smart Order Routing & Capital Management (Deployable Capital Aggregation) implementiert.
   - Data Ingestion & Persistence: Candle-Metrics & Persistenz in Redis/PostgreSQL. Funding Monitor & Liquidation Collector angepasst. OKX auf EEA-Production aktualisiert.
   - Ops & Config: `.env` Konfiguration (21 Variablen), Task-Runner (`scripts/tasks.py`) statt Makefile, Wartungsfeatures (Cache/Redis/PG Cleanup), Nginx-Konfiguration aktualisiert.

   *3) Offene Aufgaben und Luecken*
   - Tasks: 0 im System (Flow `tasksTotal: 0`). Explizit unklar.
   - Regime Detection & Signal Fusion: In Beschreibung genannt, aber in Commits nicht explizit als abgeschlossene Features sichtbar. Status Unbekannt/Impliziert vorhanden oder ausstehend.
   - Smart Order Routing: Erwähnt im Titel, Implementierungsdetails in Commits nur angedeutet (Capital Management). Vollständigkeit Unbekannt.
   - Monitoring/Alerting: Grafana-Link vorhanden, aber Integration/Pipelines im Repo nicht explizit dokumentiert. Status Unbekannt.
   - Backtesting: UI implementiert, Engine-Pipeline & Historische Daten-Anbindung noch zu validieren.
   - Testabdeckung: Keine Tests in Commits erwähnt. Status Unbekannt.

   *4) Risiken und Blocker*
   - Solo-Entwicklung (Dieter): Single Point of Failure, Kontextwechsel-Risiko.
   - Inaktivität seit 23.07.2026 (19 Tage bis zum "generatedAt" Datum 12.08.2026). Blocker\n