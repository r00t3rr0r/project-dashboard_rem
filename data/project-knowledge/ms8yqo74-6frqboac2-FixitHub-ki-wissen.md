# Projektwissen KI\n\n- Projekt-ID: ms8yqo74-6frqboac2\n- Projekt: FixitHub\n- Repository: https://github.com/r00t3rr0r/FixitHub\n- Generiert am: 2026-08-12T21:50:42.413755Z\n- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M\n\nHere's a thinking process:

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
     - No invented facts, use only input data
     - Mark missing data as "Unbekannt"
     - Formulate actionable for dev teams
   - **Input Data:** JSON containing project info, GitHub metrics/commits/repo meta, flow/tasks/releases/events/team/knowledge.

2.  **Extract Key Information from JSON:**
   - *Project:* FixitHub (rebranded to McRepair/McRepair.de based on commits)
   - *Status:* active
   - *Start Date:* 2025-11-03
   - *End Date:* Unbekannt
   - *GitHub Repo:* https://github.com/r00t3rr0r/FixitHub (private, TypeScript)
   - *Default Branch:* Main-test-14.01
   - *Metrics:* 923 total commits, last commit 2026-07-16, active days last 30: 4, contributors: 4, avg commits/week: 19.7
   - *Recent Commits (Key Themes):*
     - Branding update: FixitHub -> McRepair/McRepair.de
     - SEO enhancements: JSON-LD structured data, sitemap generation, metadata optimization across multiple pages (Blog, ProductDetail, Privacy, Partner, FAQ, Repair Catalog, etc.)
     - Admin features: Sidebar search, customer management, branding settings
     - Security hardening: Auth flows, rate limits, security headers, CORS, log redaction, dependency upgrades (nodemailer, bcrypt, jspdf, quill), crypto.randomUUID
     - Tracking/Ads: ADCELL integration & excluded customer groups
     - Order Management: StaffOrders component with unread message counts, email delivery logging/retries, Kanban interface for Schedule component
     - Localization: Language updates in HTML/sitemap URLs
   - *Tasks:* 1 task total: "Altauftragsdaten exportieren | legacy order data export" (status: todo, priority: medium, assignee: Dieter)
   - *Team/Assignees:* Dieter (Project Lead), no other team members listed.
   - *Flow Metrics:* Rhythm score: 7, Delivery score: 30, Done ratio: 0%, Overdue: 0, Due soon: 0
   - *Events:* Task creation (2026-08-03), Meeting "test" (2026-08-06)
   - *Environment/Notes/Links:* Unbekannt/empty

3.  **Map to Required Sections:**

   **1) Projektkontext**
   - Name: FixitHub (rebranded zu McRepair/McRepair.de)
   - Status: Aktiv
   - Start: 2025-11-03, Ende: Unbekannt
   - Tech Stack/Repo: TypeScript, Private GitHub Repo, Branch: Main-test-14.01
   - Team: Dieter (Project Lead), 4 Contributors insgesamt
   - Ziel/Beschreibung: Webanwendung mit Fokus auf Kundenverwaltung, Auftragsmanagement, SEO-Optimierung, Admin-Funktionen und ADCELL-Tracking. Rebranding von FixitHub zu McRepair.de ist aktuell im Gange.

   **2) Aktueller technischer Stand**
   - Branch/Commits: 923 Commits, letzter am 16.07.2026. Aktiver Entwicklungsstand auf `Main-test-14.01`.
   - Kernfeatures (laut Commits):
     - SEO: Umfassende JSON-LD Structured Data, dynamische XML-Sitemaps, Meta-Tags/Descriptions über alle Customer-Routes hinweg optimiert.
     - Admin & UI: Sidebar-Suche mit Index, Kanban-Interface für `Schedule` Component, Kundenmanagement-Verbesserungen.
     - Security: Auth-Flows gehärtet, Rate-Limits, Security Headers, CORS, Log-Redaction, Dependency-Upgrades (nodemailer, bcrypt, jspdf, Quill), Migration von UUID zu `crypto.randomUUID`.
     - Tracking & Logging: ADCELL-Integration inkl. Customer Group Exclusion, SMTP/Email-Delivery-Logging mit Retry-Logik.
     - Branding: Konsistente Übernahme von "FixitHub" auf "McRepair/McRepair.de" in Code, Env, DB, E-Mails und Logs.
   - Metriken: Rhythm Score 7, Delivery Score 30, Done Ratio 0%, aktive Tage (30T): 4.

   **3) Offene Aufgaben und Luecken**
   - Explizit im Flow: `Altauftragsdaten exportieren | legacy order data export` (Status: todo, Priority: medium, Assignee: Dieter).
   - Impliziert aus Commits/Stand:
     - Rebranding-Abgleich prüfen (alle Umgebungsvariablen, DB-Collections, E-Mail-Templates auf McRepair.de konsistent?).
     - SEO Customer Route Coverage Matrix validieren & testen.
     - ADCELL-Tracking in allen relevanten User-Journeys finalisieren.
     - Unbekannt: CI/CD-Pipeline, Testabdeckung, Deployment-Ziel, API-Dokumentation.

   **4) Risiken und Blocker**
   - Deliver Score 30 / Done Ratio 0%: Hoher Entwicklungsfortschritt im Code, aber noch keine Tasks als "done" markiert → Risiko von Scope Creep oder ungetesteten Releases.
   - Branch-Strategie: `Main-test-14.01` als Default-Branch deutet auf Testphase hin\n