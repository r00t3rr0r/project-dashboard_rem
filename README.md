# Projekt-Dashboard

Modernes SPA fuer Projektsteuerung mit modularem Vanilla-JS-Stack, lokalem Data-Layer, umfangreicher Feature-Abdeckung und neuem Designsystem.

## Stand der Anwendung

Die Anwendung wurde umfassend modernisiert:

- Komplettes UI-Redesign mit neuer Sidebar-, Toolbar- und Section-Architektur
- Einheitliche Icon-Sprache ueber Material Symbols Rounded
- Erweiterte Typografie mit IBM Plex Sans, Space Grotesk und JetBrains Mono
- Designsystem-Layer ueber [theme-override.css](theme-override.css)
- Konsolidierte Modal- und Komponenten-Styles in mehreren Modulen
- Theme-Token-Dokumentation in [THEME-TOKENS-DARK.md](THEME-TOKENS-DARK.md)

## Quickstart

### Empfohlen: Storage-Server (All-in-One)

```bash
cd C:\Users\r00t3\.openclaw\workspace\projekt-dashboard
python storage_server.py
```

Danach im Browser:

- [http://127.0.0.1:8766/app.html](http://127.0.0.1:8766/app.html)

Beim Start werden automatisch vorbereitet:

- KV-Datenbank (`data/projekt-dashboard.sqlite`)
- taegliches Backup (`data/projekt-dashboard.backup.sqlite` + `data/projekt-dashboard.backup.json`)
- automatische Wiederherstellung aus Backup, falls die KV-DB leer ist
- lokale KI-Infrastruktur-Pruefung (Ollama), optionaler Autostart via `PROJECT_DASHBOARD_OLLAMA_AUTOSTART`

### Alternative: separater Static-Server

```bash
python -m http.server 8080
```

Hinweis: Fuer volle Funktion (Persistenz, KI, GitHub-Proxy) muss trotzdem `storage_server.py` laufen.

### Direkter Datei-Start

Datei [app.html](app.html) kann direkt geoeffnet werden, aber bei manchen Browsern fuehrt file:// zu Modul- oder CORS-Einschraenkungen. Fuer stabile Nutzung HTTP-Server verwenden.

## Feature-Uebersicht (18 Bereiche)

1. Dashboard
2. Projekte
3. Kanban Board
4. Team-Kalender
5. Analytics
6. Mitarbeiter
7. Labels
8. QuickTask
9. Gesundheits-Check
10. Timeline
11. Releases
12. Standup
13. Dokumentation
14. Benachrichtigungen
15. Vorlagen
16. Sharing
17. Integrationen
18. Sprints

## Designsystem und Theming

### Layering-Strategie

- Basis-Styles liegen in [styles.css](styles.css)
- Redesign-Overrides liegen in [theme-override.css](theme-override.css)
- Reihenfolge in [app.html](app.html) ist absichtlich: erst Basis, dann Override

### Theme-Tokens

Kompakte Token-Referenz fuer Dark Theme:

- [THEME-TOKENS-DARK.md](THEME-TOKENS-DARK.md)

Diese Datei definiert:

- Typografie-Tokens
- Surface-/Text-/Border-/Accent-Tokens
- Semantisches Mapping fuer Komponenten
- Guardrails fuer neue Module

## Wichtige Neuerungen im Frontend

- Neue Shell mit klarer Navigation, Metadaten-Kicker und Bereichstiteln
- Konsistente Section-Header in zentralen Bereichen
- Ueberarbeitete Projektseite als Control-Center
- Vereinheitlichte Karten, Badges, Buttons und Form-Surfaces
- Modul-Modale auf Theme-Variablen umgestellt (inklusive Employees, Labels, Templates)
- Verbleibende Inline-Styles in den genannten Modulen weitgehend in semantische Klassen ueberfuehrt

## Lokale KI-Funktion (Projektwissen)

Die Anwendung kann pro Projekt KI-aufbereitetes Wissen erzeugen und als Markdown ablegen.

### 1) Ollama (optional manuell)

```bash
ollama pull hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M
ollama serve
```

### 2) Storage-Server starten

```bash
cd C:\Users\r00t3\.openclaw\workspace\projekt-dashboard
python storage_server.py
```

Standard-Port ist 8766 (konfigurierbar ueber PROJECT_DASHBOARD_STORAGE_PORT).

Standardmaessig versucht der Storage-Server Ollama bei Bedarf automatisch zu starten.
Deaktivieren mit:

```bash
PROJECT_DASHBOARD_OLLAMA_AUTOSTART=0 python storage_server.py
```

### 3) UI oeffnen

Beispiel:

- [http://localhost:8080/app.html](http://localhost:8080/app.html)

Die KI-Endpunkte werden vom Storage-Server bedient; generierte Inhalte landen unter [data/project-knowledge](data/project-knowledge).

## Projektstruktur

```text
projekt-dashboard/
|- app.html
|- data.js
|- styles.css
|- theme-override.css
|- THEME-TOKENS-DARK.md
|- storage_server.py
|- modules/
|  |- app.js
|  |- analytics.js
|  |- calendar.js
|  |- dashboard.js
|  |- documentation.js
|  |- employees.js
|  |- healthcheck.js
|  |- integrations.js
|  |- kanban.js
|  |- labels.js
|  |- notifications.js
|  |- projects.js
|  |- quicktask.js
|  |- releases.js
|  |- search.js
|  |- sharing.js
|  |- sprint.js
|  |- standup.js
|  |- templates.js
|  |- timeline.js
|- data/
|  |- project-data.json
|  |- project-knowledge/
```

## Datenhaltung

- Primar ueber den Storage-Server (`/api/kv`) in `data/projekt-dashboard.sqlite`
- Data-Layer in [data.js](data.js) mit lokalem Spiegel und Remote-Snapshot
- Zusaetzlicher nativer Browser-LocalStorage-Mirror fuer Offline-/Ausfall-Faelle
- Automatischer API-Fallback fuer KV-Endpunkt (`/api/kv`, `127.0.0.1:8766`, `localhost:8766`)
- Automatische Restore-Fallbacks aus `data/projekt-dashboard.backup.json` bei leerem Datenbestand
- Export/Import als JSON direkt aus der Toolbar

Reset aller Daten ueber Browser-Konsole:

```js
window.DataLayer.resetAll()
```

## Technischer Stack

- HTML, CSS, Vanilla JavaScript (modular)
- Keine Build-Pipeline notwendig
- SQL.js wird fuer DB-bezogene Workflows eingebunden

## Verwandte Doku

- API: [API.md](API.md)
- Architektur: [ARCHITECTURE.md](ARCHITECTURE.md)
- Build-Hinweise: [BUILD.md](BUILD.md)
- Schema: [SCHEMA.md](SCHEMA.md)
- Changelog: [Changelog.md](Changelog.md)

## Lizenz

Eigenes Projekt, alle Rechte beim Autor.
