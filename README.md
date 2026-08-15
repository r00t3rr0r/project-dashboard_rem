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

Voraussetzungen:

- Python 3.10+
- Port `8766` frei (oder alternativen Port setzen)

macOS / Linux (LAN-ready, mit auto-konfigurierten Trusted Origins):

```bash
cd /Users/DNS/Projects/projekt-dashboard
./scripts/start-lan-server.sh
```

Optional mit eigenen Werten:

```bash
PROJECT_DASHBOARD_STORAGE_HOST=0.0.0.0 PROJECT_DASHBOARD_STORAGE_PORT=8766 ./scripts/start-lan-server.sh
```

Direktstart (ohne Skript):

```bash
cd /Users/DNS/Projects/projekt-dashboard
python3 storage_server.py
```

Danach im Browser:

- [http://127.0.0.1:8766/app.html](http://127.0.0.1:8766/app.html)

Aus dem lokalen Netzwerk:

- Beispiel: http://192.168.1.50:8766/app.html

## Internetbetrieb (Mehrere Mitarbeiter gleichzeitig)

Empfohlene Struktur fuer den produktiven Betrieb:

1. Zentraler Storage-Server (Single Source of Truth)
2. Reverse Proxy mit TLS (z. B. Nginx/Caddy)
3. Feste Trusted Origins ueber `PROJECT_DASHBOARD_TRUSTED_ORIGINS`
4. Geschuetzter API-Zugriff per Admin-PIN Header
5. Clients mit periodischem Remote-Sync (automatisches Nachladen)

Damit koennen mehrere Mitarbeiter parallel arbeiten: jede Aenderung wird zentral in `data/projekt-dashboard.sqlite` gespeichert und andere Clients laden Aenderungen automatisch nach.

## Server-Setup (Linux, produktionsnah)

Die folgenden Schritte setzen einen Linux-Server mit `systemd` und `nginx` voraus.

### 1) Projekt auf den Server legen

```bash
sudo mkdir -p /opt/projekt-dashboard
sudo rsync -a --delete ./ /opt/projekt-dashboard/
sudo chown -R www-data:www-data /opt/projekt-dashboard
```

### 2) Runtime-Umgebung setzen

```bash
sudo tee /etc/projekt-dashboard.env >/dev/null <<'EOF'
PROJECT_DASHBOARD_STORAGE_HOST=127.0.0.1
PROJECT_DASHBOARD_STORAGE_PORT=8766
PROJECT_DASHBOARD_ADMIN_PIN=1337
PROJECT_DASHBOARD_TRUSTED_ORIGINS=https://dashboard.example.com
PROJECT_DASHBOARD_OLLAMA_AUTOSTART=0
EOF
```

Hinweise:

- `PROJECT_DASHBOARD_STORAGE_HOST=127.0.0.1` bindet den App-Server nur lokal.
- Den Zugriff aus dem Internet uebernimmt danach ausschließlich Nginx auf Port 443.
- Fuer Team/LAN ohne Reverse Proxy kann `0.0.0.0` verwendet werden.

### 3) systemd-Service erstellen

```bash
sudo tee /etc/systemd/system/projekt-dashboard.service >/dev/null <<'EOF'
[Unit]
Description=Projekt Dashboard Storage Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/projekt-dashboard
EnvironmentFile=/etc/projekt-dashboard.env
ExecStart=/usr/bin/python3 /opt/projekt-dashboard/storage_server.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now projekt-dashboard
sudo systemctl status projekt-dashboard
```

### 4) Nginx Reverse Proxy + TLS

```bash
sudo tee /etc/nginx/sites-available/projekt-dashboard.conf >/dev/null <<'EOF'
server {
	listen 80;
	server_name dashboard.example.com;
	return 301 https://$host$request_uri;
}

server {
	listen 443 ssl http2;
	server_name dashboard.example.com;

	ssl_certificate /etc/letsencrypt/live/dashboard.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/dashboard.example.com/privkey.pem;

	location / {
		proxy_pass http://127.0.0.1:8766;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}
}
EOF

sudo ln -s /etc/nginx/sites-available/projekt-dashboard.conf /etc/nginx/sites-enabled/projekt-dashboard.conf
sudo nginx -t
sudo systemctl reload nginx
```

Danach ist die App erreichbar unter:

- https://dashboard.example.com/app.html

### 5) Funktionstest

Health-Check:

```bash
curl -sS http://127.0.0.1:8766/api/health
```

Gesicherter KV-Endpunkt (ohne PIN -> 401, mit PIN -> 200):

```bash
curl -i http://127.0.0.1:8766/api/kv
curl -i -H 'X-Admin-Pin: 1337' http://127.0.0.1:8766/api/kv
```

### 6) Update-Routine

```bash
sudo rsync -a --delete ./ /opt/projekt-dashboard/
sudo systemctl restart projekt-dashboard
sudo systemctl status projekt-dashboard
```

### Sicherheits-Gate beim Oeffnen

Beim Laden der App wird jetzt immer ein Admin-PIN abgefragt. Ohne gueltige PIN werden keine Inhalte angezeigt und API-Aufrufe auf geschuetzte Endpunkte blockiert.

- Default-PIN: `1337`
- Konfiguration per Umgebungsvariable: `PROJECT_DASHBOARD_ADMIN_PIN`
- Validierung ueber API-Endpunkt: `/api/auth/validate`

Beispiel Start mit expliziter PIN und Origins:

```bash
PROJECT_DASHBOARD_ADMIN_PIN=1337 \
PROJECT_DASHBOARD_TRUSTED_ORIGINS="https://dashboard.example.com,http://127.0.0.1:8766" \
PROJECT_DASHBOARD_STORAGE_HOST=0.0.0.0 \
PROJECT_DASHBOARD_STORAGE_PORT=8766 \
python3 storage_server.py
```

### Empfehlung fuer die Internet-Freigabe

1. Nur den Reverse Proxy ins Internet exponieren (Port 443).
2. Storage-Server intern binden oder per Firewall auf Proxy-Host beschraenken.
3. `PROJECT_DASHBOARD_TRUSTED_ORIGINS` nur auf echte Frontend-Domains setzen.
4. PIN regelmaessig wechseln (`PROJECT_DASHBOARD_ADMIN_PIN`).
5. Tägliche Backups in `data/` pruefen und extern sichern.

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
cd /Users/DNS/Projects/projekt-dashboard
python3 storage_server.py
```

Standard-Port ist 8766 (konfigurierbar ueber PROJECT_DASHBOARD_STORAGE_PORT).

Standardmaessig versucht der Storage-Server Ollama bei Bedarf automatisch zu starten.
Deaktivieren mit:

```bash
PROJECT_DASHBOARD_OLLAMA_AUTOSTART=0 python3 storage_server.py
```

### 3) UI oeffnen

Beispiel:

- [http://127.0.0.1:8766/app.html](http://127.0.0.1:8766/app.html)

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
