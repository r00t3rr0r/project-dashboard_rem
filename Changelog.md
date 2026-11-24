# Changelog

Alle bedeutenden Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Projekte-Seite: Repository-Verwaltung als zentrale Stelle fuer alle Projekt-Repositories — Uebersicht aller verknuepften Repos (Account, Sichtbarkeit, Commit-Cache, letzter Commit/Sync), Einzel-Sync je Repository und "Alle Repositories synchronisieren" (sequentiell, fehlertolerant)
- Zentraler GitHub-Token (`pd_github_central_token_v1`, serverseitig im KV-Store): Fallback fuer alle Commit- und Repository-Abrufe, damit Commits aus Repositories unterschiedlicher GitHub-Accounts (auch private) ueber einen gemeinsamen Contributor-Account (z. B. r3vm4y) abrufbar sind
- Team-Kalender: Terminbestaetigung (RSVP) mit Zusagen/Vielleicht/Absagen je Teilnehmer, Bestaetigungsuebersicht pro Termin und Panel "Offene Termineinladungen" mit Schnellantwort
- Team-Kalender: Teilnehmer-Checklisten-Auswahl im Termin-Editor mit Schnellaktionen (Projektteam uebernehmen, Alle auswaehlen, Auswahl leeren)
- Team-Kalender: Neue Terminarten "Schulung" und "Sonstiges", klickbare Typ-Legende mit Monatszaehlern zum Ein-/Ausblenden einzelner Terminarten, "Heute"-Button
- Team-Kalender: Organisatoren koennen Erinnerungen an Teilnehmer mit ausstehender Antwort senden; Benachrichtigungen bei Einladung und Antwort
- Sprint Management Page (sprint.html) mit Sprint-Erstellung, Backlog-Anzeige und Retrospective-Feld
- Public API Referenz in `API.md` — alle `window.DataLayer`-Funktionen dokumentiert

### Fixed
- Batch 3b: Leichte Fallback-Struktur für die Sprint-Seite implementiert

### Improved
- Team-Kalender: Professionellere Termindarstellung mit Typ-Icons, Ganztagskennzeichnung und Bestaetigungsindikator direkt in der Monatsansicht
- Team-Kalender: iCal-Export mit Uhrzeiten, Ort, Beschreibung, Teilnehmern und korrektem Escaping; exportiert die aktuell gefilterte Ansicht
- Konsistente CSS-Klassen (`.stat-card`, `.progress-bar-fill`, `.badge`) über alle Seiten hinweg
- Kompakte Dateistruktur — max. ~200 Zeilen pro Datei

---

## [1.0.0] — 2026-07-30

### Added
- Projekt-Dashboard Kernanwendung mit lokalem localStorage-Backend
- Kanban Board mit Drag & Drop Spalten (Backlog → To Do → In Progress → Review → Done)
- Team-Kalender mit Ereignisverwaltung
- Analytics-Dashboard mit Fortschrittsbalken und Statistiken
- Mitarbeiterverwaltung (CRUD)
- Label-System für Tasks
- QuickTask — Schnellaufgaben-Erstellung
- Sprint-Timeline auf der Timeline-Seite
- Release-Management (CRUD)
- Daily Standup-Module mit Eintragsverwaltung
- Dokumentenverwaltung und Vorlagen-System
- Benachrichtigungen mit Lese-Status
- Sharing & Freigabe-Funktionen
- Integrationen-Dashboard
- Gesundheits-Check für das System
- Export/Import als JSON-Dateien
- Dark/Light Theme Toggle (localStorage-gespeichert)
- Responsive Sidebar mit Mobile-Menü
- Event Bus (pub/sub) für Datenänderungen
