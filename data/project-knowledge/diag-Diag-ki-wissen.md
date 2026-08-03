# Projektwissen KI\n\n- Projekt-ID: diag\n- Projekt: Diag\n- Repository: https://github.com/example/repo\n- Generiert am: 2026-07-30T18:05:58.618223Z\n- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M\n\nHere's a thinking process:

1.  **Analyze User Input:**
   - **Role:** Senior Technical Program Assistant
   - **Task:** Create a compact, AI-efficient project knowledge document from provided project data.
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
   - **Input Data:**
     ```json
     {
       "project": {
         "title": "Diag"
       },
       "tasks": []
     }
     ```
     Repository: https://github.com/example/repo

2.  **Map Input to Output Sections:**
   - *1) Projektkontext:* Title is "Diag". No description, domain, or goals provided. I'll state the title and note missing details as "Unbekannt".
   - *2) Aktueller technischer Stand:* Only repo URL is given. No codebase status, architecture, or tech stack mentioned. Mark as "Unbekannt" but reference the repo.
   - *3) Offene Aufgaben und Luecken:* `tasks` array is empty. So explicitly state no tasks provided, mark as "Unbekannt".
   - *4) Risiken und Blocker:* No data. Mark as "Unbekannt".
   - *5) Naechste 10 voraussichtliche Aufgaben (priorisiert):* Need to infer logical next steps based on a typical fresh project with just a repo and title, but keep it grounded in the input. I'll list placeholder tasks that are standard for initialization/setup, prioritized logically, noting they are derived from the empty task list.
   - *6) Empfohlenes Sprint-Backlog (max. 12 Punkte):* Similar to above, pick top priorities from #5 or standard setup tasks, limit to max 12. I'll provide ~8 actionable items based on typical "Diag" (likely diagnostic/monitoring tool given the name, but I'll keep it generic/actionable).
   - *7) Wissens-Shortcuts fuer Folge-LLM-Prompts (Stichpunkte):* Extract key metadata for future prompts: Repo URL, Title, Empty task list status, need for context injection.

3.  **Draft Generation (Mental Refinement in German):**
   *(1) Projektkontext*
   - Titel: Diag
   - Repository: https://github.com/example/repo
   - Beschreibung/Zielbereich: Unbekannt
   - Stakeholder/Team: Unbekannt

   *(2) Aktueller technischer Stand*
   - Codebasis: Repository existiert, Inhalt nicht spezifiziert.
   - Architektur/Tech-Stack: Unbekannt
   - Build/Deploy-Pipeline: Unbekannt
   - Dokumentation: Unbekannt

   *(3) Offene Aufgaben und Luecken*
   - Task-Liste ist leer → Alle Anforderungen, User Stories und Technical Tasks sind aktuell Unbekannt.
   - Fehlende Spezifikationen zu Funktionsumfang, API-Schnittstellen oder Datenmodellen.
   - Klärung des Projektziels („Diag“ deutet auf Diagnose-/Monitoring-Tool hin, aber nicht bestätigt).

   *(4) Risiken und Blocker*
   - Unklare Scope/Anforderungen → Risiko für Fehlintegrationen.
   - Fehlende Tech-Stack-Definition → Abhängigkeiten und Tooling noch nicht festgelegt.
   - Kein aktiver Task-Flow → Priorisierung und Meilensteine aktuell nicht ableitbar.

   *(5) Naechste 10 voraussichtliche Aufgaben (priorisiert)*
   *(Note: I'll make them actionable and logical for a fresh repo, prioritized by standard dev workflow)*
   1. Repo-Struktur & Basis-Templates initialisieren (CI/CD, Linting, Formatting)
   2. Tech-Stack & Architektur-Dokumentation erstellen
   3. Kern-API/CLI-Schnittstelle definieren & Mock implementieren
   4. Datenmodell für Diagnose-Payloads entwerfen
   5. Unit-Test-Framework einrichten & erste Tests schreiben
   6. Build-Prozess validieren & lokale Dev-Umgebung aufsetzen
   7. Erste Integrationstests für Core-Module implementieren
   8. API-Dokumentation (OpenAPI/Swagger) generieren
   9. Deployment-Strategie (Staging/Prod) definieren
   10. Monitoring & Logging-Integration planen

   *(6) Empfohlenes Sprint-Backlog (max. 12 Punkte)*
   *(Select top actionable items, keep it tight)*
   - [ ] Repo-Boilerplate & CI/CD-Pipeline einrichten
   - [ ] Tech-Stack-Festlegung & Architektur-Doku erstellen
   - [ ] Basis-CLI/API-Skelett implementieren
   - [ ] Datenstruktur für Diagnose-Daten definieren
   - [ ] Unit-Test-Setup & erste Testfälle schreiben
   - [ ] Lokale Dev-Umgebung (Docker/Makefile) bereitstellen
   - [ ] API-Spezifikation dokumentieren
   - [ ] Erste Core-Funktion implementieren & testen

   *(7) Wissens-Shortcuts fuer Folge-LLM-Prompts (Stichpunkte)*
   - Repo: https://github.com/example/repo
   - Projektname: Diag
   - Status: Frisches Repo, leere Task-Liste
   - Tech-Stack: Unbekannt → Prompt ergänzen bei bekannt
   - Ziel: Diagnose-/Monitoring-Tool (Hypothese)
   - Nötige Kontext-Injektion vor nächster Generierung: Anforderungen, Architektur, Priorisierung, Team-Ressourcen
   - Format-Erwartung: Actionable Dev-Tasks, priorisiert, sprint-tauglich

4.\n