# Projektwissen KI\n\n- Projekt-ID: ms7tojir-33mkyihsr\n- Projekt: KI Test 8766\n- Repository: https://github.com/example/repo\n- Generiert am: 2026-07-30T18:04:52.213014Z\n- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M\n\nHere's a thinking process:

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
     - Formulate actionable for dev teams
   - **Input Data:** JSON with project info, GitHub link, flow metrics (all zeros/empty), team/tasks/releases/events/knowledge empty.

2.  **Map Input to Output Sections:**
   - *1) Projektkontext:* Project ID, Title, Status, Start/End dates, Repo URL, Description. All mostly empty except title and status. I'll note what's known and mark unknowns appropriately.
   - *2) Aktueller technischer Stand:* Based on GitHub metrics (empty), recent commits (empty), env summary (0 keys), attachments/notes/links (all 0). State that the repo is freshly initialized or data is not yet populated. Default branch unknown.
   - *3) Offene Aufgaben und Luecken:* Tasks total: 0, backlog/todo/etc.: all 0. No assignees, no notes/links. Mark as "Keine erfasst" or "Unbekannt". Note the lack of structure/documentation.
   - *4) Risiken und Blocker:* Empty flow metrics (rhythmScore: 0, deliveryScore: 0), no releases/events. Risk: Lack of tracking, unclear scope/timeline, missing team assignment.
   - *5) Naechste 10 voraussichtliche Aufgaben (priorisiert):* Since there are 0 tasks, I'll derive logical next steps based on standard project kickoff/setup, prioritized logically. Max 10. I'll keep them generic but actionable, tied to the empty state.
   - *6) Empfohlenes Sprint-Backlog (max. 12 Punkte):* Similar to #5 but formatted as a sprint backlog. Can overlap or be slightly more concrete. Max 12 points.
   - *7) Wissens-Shortcuts fuer Folge-LLM-Prompts (Stichpunkte):* Key facts for future prompts: Project ID, Title, Status, Repo URL, current metrics state, empty tasks/team/releases, date of generation.

3.  **Draft Generation (Mental Refinement in German):**
   *(1) Projektkontext*
   - Projekt-ID: ms7tojir-33mkyihsr
   - Titel: KI Test 8766
   - Status: active
   - Start-/Enddatum: Unbekannt
   - Beschreibung: Unbekannt
   - Repository: https://github.com/example/repo (Owner: example, Repo: repo)

   *(2) Aktueller technischer Stand*
   - Branch/Default-Branch: Unbekannt
   - Commits/Metrics: Keine Daten vorhanden (leeres Array/Objekt)
   - Umgebungsvariablen: 0 Schlüssel definiert
   - Dokumentation/Wissen: 0 Notizen, 0 Links, 0 Attachments
   - Fazit: Repo ist initialisiert oder noch nicht mit Inhalten/Commits befüllt. Keine CI/CD- oder Release-Daten erkennbar.

   *(3) Offene Aufgaben und Luecken*
   - Task-Volumen: 0 (Backlog, Todo, In-Progress, Review, Done alle bei 0)
   - Zuweisungen: Kein Team/Assignees konfiguriert
   - Fehlt: Klare Scope-Definition, Zeitplan, technische Architektur, Teststrategie, Dokumentation
   - Lücke: Keine Metriken für Fortschritt (Done-Ratio: 0, Rhythm/Delivery Score: 0)

   *(4) Risiken und Blocker*
   - Risiko: Fehlende Aufgabenverteilung führt zu unklaren Verantwortlichkeiten
   - Risiko: Keine Releases/Events deuten auf fehlenden Release-Zyklus oder Tracking hin
   - Blocker: Unbekanntes Start-/Enddatum und Beschreibung erschweren Priorisierung
   - Blocker: Leere Umgebungsvariablen-Liste (keyCount: 0) → Konfigurationsbasis fehlt

   *(5) Naechste 10 voraussichtliche Aufgaben (priorisiert)*
   1. Default-Branch festlegen & Repo-Struktur initialisieren
   2. Projektbeschreibung & Scope definieren
   3. Team/Assignees zuweisen & Zugriffsrechte konfigurieren
   4. Basis-Umgebungsvariablen (.env) anlegen
   5. CI/CD-Pipeline einrichten (Build/Test/Lint)
   6. Issue-Templates & PR-Template erstellen
   7. Erste Feature-/Task-Erfassung im Board
   8. Release-Ziele & Versionierung festlegen
   9. Dokumentation (README, Architektur) pflegen
   10. Ersten Commit/PR mit Basis-Code oder Konfiguration mergen

   *(6) Empfohlenes Sprint-Backlog (max. 12 Punkte)*
   - [ ] Default-Branch & Repo-Schema definieren
   - [ ] Projektbeschreibung & Scope dokumentieren
   - [ ] Assignees & Berechtigungen setzen
   - [ ] .env-Basisstruktur anlegen
   - [ ] CI/CD-Pipeline (GitHub Actions) konfigurieren
   - [ ] Issue- & PR-Templates erstellen
   - [ ] Erste Tasks im Board anlegen & priorisieren
   - [ ] Release-V1-Ziel definieren & Changelog starten
   - [ ] README.md mit Setup-Anleitung vervollständigen
   - [ ] Linting/Formatting-Regeln (ESLint/Prettier o.ä.) aktivieren
   - [ ] Erster Feature-Branch & Proof-of-Concept an\n