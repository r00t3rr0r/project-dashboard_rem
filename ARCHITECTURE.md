# Projekt-Dashboard — Architektur & Auftragsvergabe

## Ziel
Single-File HTML/CSS/JS App mit 17 Features aus FEATURES.md, gespeichert unter `projekt-dashboard/app.html`.

## Feature-Zusammenfassung (17)
1. Live-Projektübersicht (Dashboard mit Farbcodierung)
2. Mitarbeiter & Zuweisungen
3. Projektdokumentation (Vorlagen + Auto-Generate)
4. Schnellaufgabe erstellen (< 10 Sek)
5. Fortschrittsverlauf & Timeline (Gantt-ähnlich)
6. Benachrichtigungen & Updates (@Mentions)
7. Vorlagen-System (Projekt-Templates)
8. Suche & Filter (Volltext + Multi-Filter)
9. External Sharing (Public View + Shareable Links)
10. Integrationen (GitHub Sync, Kalender, RSS)
11. Team-Kalender (Drag&Drop, iCal Export)
12. Kanban-Board (Drag&Drop, WIP-Limits, Subtasks)
13. Arbeitsprozess-Dashboard (Burndown, CFD, DORA, Velocity)
14. Labels & Kategorien-System (Farb-Tags, Co-Occurrence)
15. Projekt-Gesundheits-Check (Score 0-100)
16. Release-Trunk & Versionierung (Changelog Auto-Gen)
17. Standup-Generator (Daily Updates)

## Architektur der App (Single File)
```
app.html
├── CSS: Modern UI, Dark/Light Mode, Responsive Grid/Flexbox
├── JS Data Layer: localStorage mit JSON Export/Import
├── JS Modules (IIFE/ESM):
│   ├── app.js — Haupt-App, Routing, State Management
│   ├── dashboard.js — Feature 1: Live-Projektübersicht
│   ├── employees.js — Feature 2: Mitarbeiter & Zuweisungen
│   ├── documentation.js — Feature 3: Projektdokumentation
│   ├── quicktask.js — Feature 4: Schnellaufgabe erstellen
│   ├── timeline.js — Feature 5: Fortschrittsverlauf & Timeline
│   ├── notifications.js — Feature 6: Benachrichtigungen
│   ├── templates.js — Feature 7: Vorlagen-System
│   ├── search.js — Feature 8: Suche & Filter
│   ├── sharing.js — Feature 9: External Sharing
│   ├── integrations.js — Feature 10: Integrationen
│   ├── calendar.js — Feature 11: Team-Kalender
│   ├── kanban.js — Feature 12: Kanban-Board
│   ├── analytics.js — Feature 13: Arbeitsprozess-Dashboard
│   ├── labels.js — Feature 14: Labels & Kategorien
│   ├── healthcheck.js — Feature 15: Projekt-Gesundheits-Check
│   ├── releases.js — Feature 16: Release-Trunk & Versionierung
│   └── standup.js — Feature 17: Standup-Generator
├── HTML Sections: jede Section = ein Feature-Bereich
└── Data: Demo-Daten (fiktive Projekte, Mitarbeiter, Sprints)
```

## Sub-Agent Plan
5 Sub-Agents, jeweils mit eigenem Bereich:

### Agent A — `app-core` (Hauptgerüst + CSS)
- app.html Grundgerüst, Navigation, Layout
- CSS: Dark/Light Mode, Responsive Design, UI Components
- localStorage Data Layer mit Demo-Daten
- HTML/CSS Struktur für ALLE 17 Sections

### Agent B — `kanban-dashboard` (Features 1,4,5,12)
- Dashboard (Feature 1): Live-Projektübersicht mit Farbcodierung, Fortschrittsbalken
- Kanban Board (Feature 12): Drag&Drop Spalten, WIP-Limits, Subtasks
- Schnellaufgabe erstellen (Feature 4): Modal < 10 Sek
- Timeline/Gantt (Feature 5): Visuelle Timeline, Meilensteine

### Agent C — `analytics-calendar` (Features 11,13)
- Team-Kalender (Feature 11): Drag&Drop, iCal Export, Wochen/Monat
- Burndown Chart (Feature 13a)
- Cumulative Flow Diagram (Feature 13b)
- Cycle-Time + DORA Metrics (Feature 13c/d)
- Velocity + Aufgabenverteilung Charts

### Agent D — `data-management` (Features 2,7,8,14,15,16,17)
- Mitarbeiter & Zuweisungen (Feature 2)
- Vorlagen-System (Feature 7)
- Suche & Filter (Feature 8)
- Labels & Kategorien (Feature 14)
- Projekt-Gesundheits-Check (Feature 15)
- Release-Trunk & Versionierung (Feature 16)
- Standup-Generator (Feature 17)

### Agent E — `integration-docs` (Features 3,6,9,10 + Integration)
- Projektdokumentation (Feature 3): Vorlagen, Auto-Generate Changelog, Export
- Benachrichtigungen & Updates (Feature 6): @Mentions, Kommentare
- External Sharing (Feature 9): Public View, Shareable Links
- Integrationen (Feature 10): GitHub Sync, Kalender, RSS
- Finale App-Zusammenführung: Alle JS-Module zusammenfügen

## Zeitlimit
Jeder Agent hat bis zu 20 Minuten. Timeout-Check alle 5 Min durch Supervisor.
