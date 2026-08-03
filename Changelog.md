# Changelog

Alle bedeutenden Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Sprint Management Page (sprint.html) mit Sprint-Erstellung, Backlog-Anzeige und Retrospective-Feld
- Public API Referenz in `API.md` — alle `window.DataLayer`-Funktionen dokumentiert

### Fixed
- Batch 3b: Leichte Fallback-Struktur für die Sprint-Seite implementiert

### Improved
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
