# KI Aufarbeitung

- Projekt-ID: ms8yqo74-6frqboac2
- Projekt: FixitHub
- Stufe: task-draft
- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M
- Generiert am: 2026-08-12T22:10:46.322817Z

## Prompt

```
Du bist ein zweisprachiger Projektassistent (Deutsch/Englisch) fuer die operative Aufgabenplanung. Nutze Meeting-Notizen und User-Input, um eine realistische Aufgabe und optional einen Termin zu entwerfen.\n\nProjekt: FixitHub\nVorgaben aus der UI:\n- Terminart (Task-Schedule): none\n- Termin-Typ (Kalender): task\n- Unteraufgaben erzeugen: ja\n\n- Mehrere Aufgaben aufteilen: ja\n\nMeeting-Notizen:\n- (keine Notizen)\n\nBenutzereingabe:\nBitte leite aus dem zuletzt generierten Projektwissen konkrete naechste Aufgaben fuer das Projekt ab.

Projekt: FixitHub

Projektstatus: active

KI-Wissensdatei: /data/project-knowledge/ms8yqo74-6frqboac2-FixitHub-ki-wissen.md

KI-Lauf: 2026-08-12T21:50:42.413755Z

Offene Aufgaben: 1, In Progress: 0, Due soon: 0, Overdue: 0

Erzeuge bevorzugt mehrere umsetzbare Aufgabenpakete mit klaren Prioritaeten und realistischem Aufwand.

Auszug aus dem generierten Projektwissen:

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
   - Branch-Strategie: `Main-test-14.01` als Default-Branch deutet auf Testphase hin\n\n\nBestehende Projektdaten (JSON):\n{
  "generatedAt": "2026-08-12T22:10:08.003Z",
  "project": {
    "id": "ms8yqo74-6frqboac2",
    "title": "FixitHub",
    "description": "Aus GitHub importiert",
    "status": "active",
    "startDate": "2025-11-03",
    "endDate": ""
  },
  "github": {
    "source": "link",
    "url": "https://github.com/r00t3rr0r/FixitHub",
    "owner": "r00t3rr0r",
    "repo": "FixitHub",
    "defaultBranch": "Main-test-14.01",
    "metrics": {
      "totalCommits": 923,
      "commitsLast7Days": 0,
      "activeDaysLast30Days": 4,
      "contributors": 4,
      "avgCommitsPerWeek": 19.7,
      "lastCommitAt": "2026-07-16T10:36:54Z",
      "firstCommitAt": "2025-08-22T01:15:38Z",
      "syncedAt": "2026-08-02T03:10:05.661Z"
    },
    "recentCommits": [
      {
        "sha": "67676b3e3be438331e480e43f1b08d5080cb24b0",
        "message": "Merge pull request #96 from r00t3rr0r/FrontendLocalCopilotTest\n\nEnhance customer management, SEO, branding, and admin features",
        "author": "r00t3rr0r",
        "authorLogin": "r00t3rr0r",
        "authorProfileUrl": "https://github.com/r00t3rr0r",
        "authorAvatarUrl": "https://avatars.githubusercontent.com/u/221973452?v=4",
        "authorEmail": "dieter.senf@icloud.com",
        "date": "2026-07-16T10:36:54Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/67676b3e3be438331e480e43f1b08d5080cb24b0"
      },
      {
        "sha": "824bada6b382d20322c4fc4665718e7903648d82",
        "message": "feat: Add Admin Sidebar search functionality with search index and styling",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-16T10:34:36Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/824bada6b382d20322c4fc4665718e7903648d82"
      },
      {
        "sha": "8352e0f0fdc36ae5d65e0a76c40753f62d5bdc86",
        "message": "feat: Update branding references from FixitHub to McRepair across multiple files",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-16T10:11:52Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/8352e0f0fdc36ae5d65e0a76c40753f62d5bdc86"
      },
      {
        "sha": "9971556d881e7455e7201cb21e5c0a7cf58620c0",
        "message": "feat: Implement SEO settings normalization and migration script for legacy URLs",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-16T09:55:34Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/9971556d881e7455e7201cb21e5c0a7cf58620c0"
      },
      {
        "sha": "e9193d912e000336018c39b144c7698eb9262408",
        "message": "feat: Add ADCELL excluded customer groups management and tracking integration",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-16T09:37:57Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/e9193d912e000336018c39b144c7698eb9262408"
      },
      {
        "sha": "313a22a95386bf766287656538871574c1dcbe64",
        "message": "Merge pull request #95 from r00t3rr0r/FrontendLocalCopilotTest\n\nHarden security controls and enhance order management features",
        "author": "r00t3rr0r",
        "authorLogin": "r00t3rr0r",
        "authorProfileUrl": "https://github.com/r00t3rr0r",
        "authorAvatarUrl": "https://avatars.githubusercontent.com/u/221973452?v=4",
        "authorEmail": "dieter.senf@icloud.com",
        "date": "2026-07-16T09:22:39Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/313a22a95386bf766287656538871574c1dcbe64"
      },
      {
        "sha": "627bdb6d62356e29e99226020c37ba15e9182bb1",
        "message": "feat: Implement ADCELL tracking configuration and integration across the application",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-16T09:02:57Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/627bdb6d62356e29e99226020c37ba15e9182bb1"
      },
      {
        "sha": "107a1e862182854a94c1d59c34aeef5e55b90168",
        "message": "feat: Enhance StaffOrders component with unread message counts for orders and repair requests\n\n- Added functionality to fetch and display unread message counts for assigned orders and repair requests.\n- Updated UI to show badges indicating the number of unread messages for each order and repair request.\n- Improved email delivery logging with detailed SMTP connection events and email delivery statuses.\n- Introduced new logs for email retries and email service actions for better tracking.\n- Added a new test script for workflow assignment to validate the integration of workflows with orders.",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-13T11:13:08Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/107a1e862182854a94c1d59c34aeef5e55b90168"
      },
      {
        "sha": "782c56a92b9f410bce1a315295cb31990c476c6e",
        "message": "feat: Refactor Schedule component to enhance order and repair request management with Kanban interface",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-13T09:18:03Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/782c56a92b9f410bce1a315295cb31990c476c6e"
      },
      {
        "sha": "dcce93f3900ab531753604d37e5976345d2199b6",
        "message": "Harden security controls and apply dependency security upgrades\n\n- tighten auth flows and input/rate controls for sensitive endpoints\n- add central security headers, safer CORS handling, and log redaction\n- remove uuid usage in favor of crypto.randomUUID\n- upgrade vulnerable dependencies (nodemailer, bcrypt, jspdf, quill editor stack)\n- update docs for new security-related environment variables\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-13T08:51:57Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/dcce93f3900ab531753604d37e5976345d2199b6"
      },
      {
        "sha": "44147bb248566f8a81ecd35463a0d840bc07d334",
        "message": "Merge pull request #94 from r00t3rr0r/FrontendLocalCopilotTest\n\nEnhance SEO components and structured data across multiple pages",
        "author": "r00t3rr0r",
        "authorLogin": "r00t3rr0r",
        "authorProfileUrl": "https://github.com/r00t3rr0r",
        "authorAvatarUrl": "https://avatars.githubusercontent.com/u/221973452?v=4",
        "authorEmail": "dieter.senf@icloud.com",
        "date": "2026-07-13T08:13:12Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/44147bb248566f8a81ecd35463a0d840bc07d334"
      },
      {
        "sha": "63f610d86220b0ba53cd3c99924410fdbc734ed2",
        "message": "feat: Update language in HTML and sitemap URLs for improved localization",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T19:30:30Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/63f610d86220b0ba53cd3c99924410fdbc734ed2"
      },
      {
        "sha": "280042986443047fb9f958da29e560d2791d8026",
        "message": "feat: Update SEO title and description handling in BlogPost for improved clarity and character limits",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T19:23:31Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/280042986443047fb9f958da29e560d2791d8026"
      },
      {
        "sha": "87344c309bd48ec2ed109ff5cd657d7c5aa394b5",
        "message": "feat: Update SEO descriptions across multiple pages for improved clarity and keyword optimization",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T19:11:21Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/87344c309bd48ec2ed109ff5cd657d7c5aa394b5"
      },
      {
        "sha": "eae72323d7b7d3cf394d32ccb7d70a9dff2b113e",
        "message": "feat: Enhance SEO components in Blog and BlogPost pages with structured data, keywords, and improved metadata",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T18:49:07Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/eae72323d7b7d3cf394d32ccb7d70a9dff2b113e"
      },
      {
        "sha": "95e34c8b050dd8ef7b230085000efc1527a23a79",
        "message": "fix: Add margin to button in ProductDetail for improved layout",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T17:56:53Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/95e34c8b050dd8ef7b230085000efc1527a23a79"
      },
      {
        "sha": "5d7f1d9f549d7b15fa52c737a0744526405fd36d",
        "message": "feat: Enhance SEO component and ProductDetail page with structured data, product details, and accessibility improvements",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T17:54:07Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/5d7f1d9f549d7b15fa52c737a0744526405fd36d"
      },
      {
        "sha": "230932957f57ebcfa56d072d19a8f010663a30a9",
        "message": "Enhance Battery Disposal, Imprint, and Shipping & Payment pages with structured data and accessibility improvements\n\n- Added JSON-LD structured data for Battery Disposal and Imprint pages to improve SEO.\n- Implemented visually hidden elements for screen readers in Battery Disposal and Imprint CSS.\n- Updated Battery Disposal page layout with new sections for legal obligations, return address, and battery symbols.\n- Enhanced Imprint page with detailed organizational information and contact details.\n- Introduced breadcrumb navigation in Shipping & Payment page for better user experience and SEO.\n- Improved Shipping & Payment page with structured data for payment methods and shipping terms.\n- Refined styles for better readability and accessibility across all modified pages.",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T17:46:43Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/230932957f57ebcfa56d072d19a8f010663a30a9"
      },
      {
        "sha": "6fa0509caa5275c5766dad1f60f2857a98b98129",
        "message": "feat: Enhance Privacy and Withdrawal pages with structured data, SEO improvements, and new styles",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T17:06:23Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/6fa0509caa5275c5766dad1f60f2857a98b98129"
      },
      {
        "sha": "32065ccd58068bb2fe2b8eedc6b7b47b0a3edf53",
        "message": "Enhance Partner and Newsletter Pages with New Features and Content\n\n- Updated translation.json to include additional information about McRepair services, benefits, and FAQs for partners.\n- Revamped Newsletter component to include benefits, FAQs, and structured data (JSON-LD) for better SEO.\n- Improved PartnerWerden page layout with enhanced FAQ section, advantages, and steps to become a partner.\n- Added accessibility features and improved user experience across both pages.",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T16:56:21Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/32065ccd58068bb2fe2b8eedc6b7b47b0a3edf53"
      },
      {
        "sha": "d62cdf60af16041fa30182e29163bf827daadb1e",
        "message": "feat: Implement JSON-LD structured data for FAQ page and add public API endpoint for SEO",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T16:44:40Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/d62cdf60af16041fa30182e29163bf827daadb1e"
      },
      {
        "sha": "03dc6cfc72d2f92b5102fee4d97bf8f08e4eea9a",
        "message": "feat: Add JSON-LD structured data for repair request page and enhance SEO content",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T16:23:54Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/03dc6cfc72d2f92b5102fee4d97bf8f08e4eea9a"
      },
      {
        "sha": "a5292ae347351b6e36052d75cf4897b2a018a353",
        "message": "feat: Add JSON-LD structured data and enhance SEO sections for Vorabdiagnose page",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T16:15:36Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/a5292ae347351b6e36052d75cf4897b2a018a353"
      },
      {
        "sha": "5b4275e5e351cf83107f0760960d679daab869ed",
        "message": "Refactor application branding from FixitHub to McRepair.de across all relevant scripts and services, including environment setup, MongoDB authentication, email templates, and logging utilities. Update support email addresses, company names, and other branding elements to reflect the new application identity.",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T16:00:22Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/5b4275e5e351cf83107f0760960d679daab869ed"
      },
      {
        "sha": "d51936026c3b97afebda22e818d0083b4b54059b",
        "message": "feat: Enhance SEO and repair catalog functionality\n\n- Added SEO components to DebugLogin, Home, ResetPassword, and VerifyEmail pages for improved search engine visibility.\n- Implemented a repair catalog feature in Home page with crawlable links for device types, manufacturers, and models.\n- Introduced new RepairCatalogPage to handle three-level SEO landing pages for repair services.\n- Created public API endpoints for fetching repair catalog data, including device types, manufacturers, models, and associated services.\n- Developed dynamic XML sitemap generation for better indexing of repair catalog pages.\n- Established a comprehensive SEO Customer Route Coverage Matrix to ensure all customer-accessible routes are optimized for search engines.",
        "author": "r00t3rr0r",
        "authorLogin": "",
        "authorProfileUrl": "",
        "authorAvatarUrl": "",
        "authorEmail": "r00t3rr0r@icloud.com",
        "date": "2026-07-12T15:49:43Z",
        "url": "https://github.com/r00t3rr0r/FixitHub/commit/d51936026c3b97afebda22e818d0083b4b54059b"
      }
    ],
    "repoMeta": {
      "stars": 2,
      "forks": 0,
      "openIssues": 0,
      "language": "TypeScript",
      "visibility": "private",
      "htmlUrl": "https://github.com/r00t3rr0r/FixitHub",
      "pushedAt": "2026-07-27T09:39:16Z"
    }
  },
  "flow": {
    "tasksTotal": 1,
    "statusCounts": {
      "backlog": 0,
      "todo": 1,
      "in-progress": 0,
      "review": 0,
      "done": 0,
      "other": 0
    },
    "dueSoon": 0,
    "overdue": 0,
    "releases": 0,
    "events": 0,
    "assignees": [
      {
        "employeeId": "emp_ms8rcqoadwvhx",
        "employeeName": "Dieter",
        "role": "Project Lead"
      }
    ],
    "teamMembers": [],
    "doneRatio": 0,
    "rhythmScore": 7,
    "deliveryScore": 30,
    "attachmentCount": 0,
    "noteCount": 0,
    "linkCount": 0,
    "secretCount": 0,
    "envSummary": {
      "keyCount": 0,
      "sample": []
    }
  },
  "team": {
    "assignees": {
      "emp_ms8rcqoadwvhx": {
        "id": "emp_ms8rcqoadwvhx",
        "name": "Dieter",
        "role": "Project Lead"
      }
    },
    "projectRoles": []
  },
  "tasks": [
    {
      "id": "msavgq8l-w0h8fz3so",
      "title": "Altauftragsdaten exportieren | legacy order data export",
      "description": "DE:\nTeilaufgabe aus Eingabetext: Altauftragsdaten exportieren\n\nEN:\nSubtask derived from input: legacy order data export",
      "status": "todo",
      "priority": "medium",
      "assigneeId": "emp_ms8rcqoadwvhx",
      "assigneeName": "Dieter",
      "dueDate": "",
      "labels": [],
      "updatedAt": "2026-08-02T04:56:58.956Z"
    }
  ],
  "releases": [],
  "events": [],
  "knowledge": {
    "links": [],
    "notes": [],
    "envSummary": {
      "keyCount": 0,
      "sample": []
    },
    "attachmentNames": [],
    "scratchpad": ""
  }
}\n\nWichtig:\n- Formuliere praezise, klar und fuer alle Mitarbeiter verstaendlich.\n- Liefere Titel und Beschreibung immer in Deutsch UND Englisch.\n- Nutze realistische Werte fuer Prioritaet, Dringlichkeit, Aufwand und Labels.\n- Wenn Unteraufgaben deaktiviert sind, gib leere Listen fuer subtasksDe/subtasksEn zurueck.\n- Wenn "Mehrere Aufgaben aufteilen" = ja und die Eingabe mehrere eigenstaendige Arbeitspakete enthaelt, fuelle taskSuggestions mit 2-8 Aufgaben.\n- Nummeriere Hauptaufgabe und Vorschlaege mit sequenceIndex. Setze dependsOnPrevious=true fuer jede Folgeaufgabe, die inhaltlich auf der vorherigen aufbaut.
- Wenn keine sinnvolle Aufteilung moeglich ist, liefere taskSuggestions als leeres Array.\n- Gib Datumswerte im Format YYYY-MM-DD aus, Zeiten als HH:MM oder leer.\n- Erfinde keine harten Fakten, wenn sie nicht aus den Eingaben ableitbar sind.\n\nAntworte nur mit einem gueltigen JSON-Objekt in exakt diesem Format (ohne Markdown, ohne Codeblock):\n{\n  "summaryMarkdown": "...",\n  "task": {\n    "titleDe": "...",\n    "titleEn": "...",\n    "descriptionDe": "...",\n    "descriptionEn": "...",\n    "priority": "medium",\n    "urgency": "normal",\n    "effortHours": 3.5,\n    "labels": ["..."],\n    "schedule": {"mode": "none", "deadline": "", "fixedAt": "", "rangeStart": "", "rangeEnd": ""},\n    "sequenceIndex": 1,
    "dependsOnPrevious": false,
    "subtasksDe": ["..."],\n    "subtasksEn": ["..."],\n    "note": "..."\n  },\n  "taskSuggestions": [\n    {"titleDe":"...","titleEn":"...","descriptionDe":"...","descriptionEn":"...","priority":"medium","urgency":"normal","effortHours":2,"labels":["..."],"sequenceIndex":1,"dependsOnPrevious":false,"note":"..."}
  ],\n  "event": {\n    "create": true,\n    "title": "...",\n    "description": "...",\n    "type": "meeting",\n    "date": "YYYY-MM-DD",\n    "startTime": "HH:MM",\n    "endTime": "HH:MM"\n  }
}
Wichtig: Nur JSON zurueckgeben. Kein Vorwort, keine Analyse, keine Schritt-fuer-Schritt-Erklaerung.
```

## Ergebnis

Basierend auf dem aktuellen Projektstatus (FixitHub/McRepair) und den offenen Aufgaben wird die Migration der Legacy-Auftragsdaten priorisiert. Zusätzlich werden drei weitere sinnvolle Arbeitspakete vorgeschlagen: Validierung des Rebrandings, SEO-Abgleich für Customer Routes und ADCELL-Tracking-Finalisierung.
