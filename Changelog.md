# Changelog

Alle bedeutenden Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Admin-Header: Button "Version / Update" zeigt Version, Commit, Branch, Repository, Datenbank und Serverstart und aktualisiert das Dashboard aus dem GitHub-Repo (`/api/system/version`, `/api/system/update/check|apply`): nur Admins, nur Fast-Forward, DB-Backup und Syntaxpruefung vorab sowie Server-Neustart. Konfiguration ueber `PROJECT_DASHBOARD_UPDATE_REMOTE`/`PROJECT_DASHBOARD_UPDATE_BRANCH` (Standard `origin`/`main`)
- GitHub-Commit-Dokumentation (QuickTask "Neue GitHub-Commits abrufen" und AI-Conf "Erledigte Aufgaben aus GitHub"): Tagesaufgaben werden jetzt pro Mitarbeiter und Tag erstellt und automatisch dem jeweiligen Commit-Autor zugewiesen (Vorschlag ueber GitHub-Login bzw. hinterlegte Aliase); beim Aendern einer Commit-Zuordnung werden die Aufgabenentwuerfe live pro Mitarbeiter neu gruppiert (Titel, Beschreibung, Teilaufgaben und Anhaenge je Mitarbeiter)
- Projekte-Seite: Repository-Verwaltung als zentrale Stelle fuer alle Projekt-Repositories — Uebersicht aller verknuepften Repos (Account, Sichtbarkeit, Commit-Cache, letzter Commit/Sync), Einzel-Sync je Repository und "Alle Repositories synchronisieren" (sequentiell, fehlertolerant)
- Zentraler GitHub-Token (`pd_github_central_token_v1`, serverseitig im KV-Store): Fallback fuer alle Commit- und Repository-Abrufe, damit Commits aus Repositories unterschiedlicher GitHub-Accounts (auch private) ueber einen gemeinsamen Contributor-Account (z. B. r3vm4y) abrufbar sind
- Team-Kalender: Terminbestaetigung (RSVP) mit Zusagen/Vielleicht/Absagen je Teilnehmer, Bestaetigungsuebersicht pro Termin und Panel "Offene Termineinladungen" mit Schnellantwort
- Team-Kalender: Teilnehmer-Checklisten-Auswahl im Termin-Editor mit Schnellaktionen (Projektteam uebernehmen, Alle auswaehlen, Auswahl leeren)
- Team-Kalender: Neue Terminarten "Schulung" und "Sonstiges", klickbare Typ-Legende mit Monatszaehlern zum Ein-/Ausblenden einzelner Terminarten, "Heute"-Button
- Team-Kalender: Organisatoren koennen Erinnerungen an Teilnehmer mit ausstehender Antwort senden; Benachrichtigungen bei Einladung und Antwort
- Sprint Management Page (sprint.html) mit Sprint-Erstellung, Backlog-Anzeige und Retrospective-Feld
- Public API Referenz in `API.md` — alle `window.DataLayer`-Funktionen dokumentiert

### Fixed
- KI-Uebersetzung der GitHub-Commits bricht nicht mehr komplett ab, wenn ein Uebersetzungs-Batch unvollstaendig oder mit falscher SHA antwortet — fehlende Commits werden automatisch einzeln nachuebersetzt
- QuickTask "Neue GitHub-Commits abrufen" und AI-Conf-Commit-Import: Bei ungueltigem/abgelaufenem GitHub-Token wird jetzt automatisch auf den zentralen Token und zuletzt auf einen unauthentifizierten Abruf (oeffentliche Repositories) zurueckgefallen statt mit 401 abzubrechen; fehlende Dashboard-Anmeldung wird klar gemeldet
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
