# Projekt-Dashboard

Modernes SPA fuer Projektsteuerung mit modularem Vanilla-JS-Stack, lokalem Data-Layer, umfangreicher Feature-Abdeckung und neuem Designsystem.

## Stand der Anwendung

Die Anwendung wurde umfassend modernisiert:

- Komplettes UI-Redesign mit neuer Sidebar-, Toolbar- und Section-Architektur
- Einheitliche Icon-Sprache ueber Material Symbols Rounded
- Erweiterte Typografie mit IBM Plex Sans, Space Grotesk und JetBrains Mono
- Dark Mode als Standard; eine gespeicherte Light-Mode-Auswahl bleibt erhalten
- Designsystem-Layer ueber [theme-override.css](theme-override.css)
- Konsolidierte Modal- und Komponenten-Styles in mehreren Modulen
- Theme-Token-Dokumentation in [THEME-TOKENS-DARK.md](THEME-TOKENS-DARK.md)

Bei Aufgaben mit Teilaufgaben wird der Aufgabenfortschritt automatisch aus dem Anteil der erledigten Teilaufgaben berechnet. Die Bereiche „Aufgabenverteilung“ und „Projekt-Fortschritt“ zeigen für Aufgaben in Bearbeitung die aktuell bearbeitete und die nächste offene Teilaufgabe; weitere offene Teilaufgaben lassen sich darunter aufklappen. Unter „Heute erledigt“ erscheinen alle Aufgaben, die der Mitarbeiter heute abgeschlossen hat (Statuswechsel auf „Erledigt“ bzw. bei GitHub-Commit-Dokumentation das Commit-Datum), sowie heute abgehakte Teilaufgaben weiterer Aufgaben. Zu jeder Aufgabe werden die heutigen Entwicklungsschritte (GitHub-Commits mit Uhrzeit, Kurz-SHA und Link sowie abgehakte Teilaufgaben) aufgelistet; heutige Commits aus dem GitHub-Cache eines Projekts, die noch keiner Aufgabe zugeordnet sind, erscheinen unter „Commits ohne Aufgabe“ (Zuordnung über GitHub-Benutzername bzw. Aliase des Mitarbeiters). Ein Klick auf eine erledigte Aufgabe, Teilaufgabe oder einen Commit öffnet die komplette Aufgabe in der Detailansicht (inklusive aller Teilaufgaben und GitHub-Commits, der angeklickte Schritt wird hervorgehoben); Commits ohne Aufgabe öffnen eine Commit-Detailansicht. Mitarbeiter mit heute erledigten Aufgaben werden auch ohne aktive Aufgabe angezeigt. Der Aufgabenstatus wird dadurch nicht automatisch geändert. Ohne Teilaufgaben bleibt der Fortschritt manuell einstellbar.

Im „Projekt-Fortschritt“ erscheinen Aufgaben mit mehreren Projektzuordnungen einmal gesammelt unter „Projektübergreifende Aufgaben“, jeweils mit den verknüpften Projekten. Aufgaben ohne Projekt bleiben separat unter „Ohne Projekt“ sichtbar.
Projekt, Aufgabe und Teilaufgaben sind dort als getrennte Ebenen gekennzeichnet. Bei Aufgaben mit importierten GitHub-Commits werden die neuesten zugeordneten Commits angezeigt; weitere lassen sich aufklappen und öffnen die jeweilige Aufgabendetailansicht. Die Statusanimation berücksichtigt die Systemeinstellung für reduzierte Bewegung.
Projektkarten mit aktiven Aufgaben und ihre Fortschrittsfelder zeigen einen umlaufenden Lichtimpuls; bei reduzierter Bewegung bleibt die Kennzeichnung statisch.

## Repository-Verwaltung (Projekte-Seite)

Die Projekte-Seite ist die zentrale Stelle zum Administrieren der Projekte und ihrer GitHub-Repositories. Über den Button „Repositories" öffnet sich die Repository-Verwaltung:

- **Zentraler GitHub-Token**: Token eines Accounts, der in allen Projekt-Repositories Contributor ist (z. B. `r3vm4y`). Er wird serverseitig im KV-Store gespeichert (`pd_github_central_token_v1`), gilt damit für alle Clients und dient als Fallback für alle Commit- und Repository-Abrufe, wenn der angemeldete Mitarbeiter keinen eigenen Token hinterlegt hat. So lassen sich Commits aus Repositories verschiedener GitHub-Accounts (auch private) abrufen.
- **Repository-Übersicht**: Alle Projekte mit verknüpftem Repository inklusive Sichtbarkeit, Commit-Cache, letztem Commit und letztem Sync.
- **Synchronisation**: Commits pro Repository oder über „Alle Repositories synchronisieren" für sämtliche Projekte auf einmal (sequentiell, um das GitHub-Rate-Limit zu schonen). Fehler einzelner Repositories stoppen den Gesamtlauf nicht.

Token-Auflösung bei GitHub-Abrufen: Formularfeld → Session → Token des angemeldeten Mitarbeiters → zentraler Token.

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

### Live-URL-Screenshots

Für die eigene Screenshot-Funktion muss Docker auf dem Storage-Server laufen und das Image einmal sowie nach Änderungen an `scripts/screenshot` erneut gebaut werden:

```bash
docker build -t project-dashboard-screenshot:1 scripts/screenshot
```

Anschließend den Storage-Server neu starten. Sein Benutzer benötigt Zugriff auf Docker; dieser Zugriff gewährt weitreichende Rechte auf dem Host. Beim ersten Öffnen einer Projektkarte erstellt ein bearbeitungsberechtigter Benutzer automatisch eine Vorschau, die sich auch manuell aktualisieren und per Maus oder Klick vergrößern lässt. Der Screenshot wird zusammen mit der aktuellen Live-URL in SQLite gespeichert und ist im SQLite-Backup enthalten.

Der Browser läuft ohne eigenes Netzwerk. Der Relay erlaubt nur öffentliche IP-Adressen und Anfragen an den Host der Live-URL; externe Ressourcen, Weiterleitungen auf andere Hosts, private Adressen und Seiten mit Anmeldung können daher fehlen oder nicht funktionieren. Bei nicht laufendem Docker oder fehlendem Image erscheint ein Fehler in der Projektkarte.

## Internetbetrieb (Mehrere Mitarbeiter gleichzeitig)

Empfohlene Struktur fuer den produktiven Betrieb:

1. Zentraler Storage-Server (Single Source of Truth)
2. Reverse Proxy mit TLS (z. B. Nginx/Caddy)
3. Feste Trusted Origins ueber `PROJECT_DASHBOARD_TRUSTED_ORIGINS`
4. Geschuetzter API-Zugriff per Mitarbeiterlogin und HttpOnly-Sitzungscookie
5. Clients mit periodischem Remote-Sync (automatisches Nachladen)

Damit koennen mehrere Mitarbeiter parallel arbeiten: jede Aenderung wird zentral in `data/projekt-dashboard.sqlite` gespeichert und andere Clients laden Aenderungen automatisch nach. Der Server bestaetigt KV-Schreibvorgaenge erst nach einem voll synchronisierten SQLite-Commit, WAL-Checkpoint und atomar aktualisierten SQLite-/JSON-Backups.

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
PROJECT_DASHBOARD_TRUSTED_ORIGINS=https://dashboard.example.com
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

Gesicherter KV-Endpunkt (ohne angemeldete Sitzung -> 401):

```bash
curl -i http://127.0.0.1:8766/api/kv
```

### 6) Update-Routine

```bash
sudo rsync -a --delete ./ /opt/projekt-dashboard/
sudo systemctl restart projekt-dashboard
sudo systemctl status projekt-dashboard
```

### Git-Selbstupdate im Admin-Bereich

Das Selbstupdate benoetigt einen sauberen Git-Checkout auf dem konfigurierten
Branch und Schreibrechte des Dienstbenutzers auf Checkout und `.git`. Der
Dienstbenutzer kann damit Anwendungscode veraendern; diese Rechte nur vergeben,
wenn das Risiko bewusst akzeptiert wird. `data/` bleibt unversioniert und muss
unabhaengig vom Checkout erhalten bleiben. Das Repository muss fuer den
Dienstbenutzer ohne interaktive Anmeldung erreichbar sein.

Admins koennen im Header unter "Version / Update" nach Updates suchen und ein
Fast-Forward-Update bestaetigen. Lokale Aenderungen, abweichende lokale
Commits, eine ungueltige Serverdatei oder ein fehlgeschlagenes
Datenbank-Backup verhindern die Installation. Vor dem Fast-Forward wird die
Serverdatei des Ziel-Commits auf Syntax geprueft und ein Datenbank-Backup
erstellt; danach startet der Server neu. Der Browser wartet auf den Neustart
mit dem neuen Commit. Der Admin-Dialog zeigt den Fortschritt anhand
abgeschlossener Schritte und ein Aktionsprotokoll; 100 % werden erst nach dem
bestaetigten Neustart erreicht. Danach kann das Dashboard neu geladen werden.
Der Fortschritt ist waehrend des Updates ueber den nur fuer Admins zugaenglichen
Endpunkt `GET /api/system/update/progress` abrufbar und bleibt bis zum Neustart
im Serverspeicher; der geoeffnete Dialog behaelt sein Protokoll anschliessend bei.
Konfiguration: `PROJECT_DASHBOARD_UPDATE_REMOTE`
(Standard `origin`) und `PROJECT_DASHBOARD_UPDATE_BRANCH` (Standard `main`).

### Sicherheits-Gate beim Oeffnen

Ohne gueltige Sitzung erscheint ausschliesslich das Loginformular. Mitarbeiter werden aus einem Dropdown ausgewaehlt und melden sich mit ihrem Passwort an. Dashboard und geschuetzte API-Endpunkte bleiben bis dahin gesperrt.

- `GET /api/auth/users` liefert ausschliesslich Namen und Benutzernamen freigeschalteter Konten fuer das Dropdown.
- `POST /api/auth/login` prueft Benutzername und Passwort auf dem Server und setzt ein HttpOnly-Cookie.
- Ohne "Angemeldet bleiben" gilt das Cookie fuer die Browsersitzung, maximal acht Stunden.
- Mit "Angemeldet bleiben" bleibt die Sitzung bis zu 30 Tage gespeichert, auch nach Browser- und Serverneustart.
- `GET /api/auth/session` prueft eine bestehende Sitzung; `POST /api/auth/logout` widerruft sie.
- Passwortwechsel und deaktivierte Logins machen bestehende Sitzungen ungueltig. Die Admin-PIN entfaellt.

Beispiel Start mit expliziten Origins:

```bash
PROJECT_DASHBOARD_TRUSTED_ORIGINS="https://dashboard.example.com,http://127.0.0.1:8766" \
PROJECT_DASHBOARD_STORAGE_HOST=0.0.0.0 \
PROJECT_DASHBOARD_STORAGE_PORT=8766 \
python3 storage_server.py
```

### Empfehlung fuer die Internet-Freigabe

1. Nur den Reverse Proxy ins Internet exponieren (Port 443).
2. Storage-Server intern binden oder per Firewall auf Proxy-Host beschraenken.
3. `PROJECT_DASHBOARD_TRUSTED_ORIGINS` nur auf echte Frontend-Domains setzen.
4. Individuelle Mitarbeiterkonten mit sicheren Passwoertern verwenden und ausgeschiedene Konten deaktivieren.
5. Backups in `data/` pruefen und zusaetzlich extern sichern.

Beim Start werden automatisch vorbereitet:

- KV-Datenbank (`data/projekt-dashboard.sqlite`)
- bei jeder KV-Aenderung atomar aktualisierte Backups (`data/projekt-dashboard.backup.sqlite` + `data/projekt-dashboard.backup.json`)
- automatische Wiederherstellung aus Backup, falls die KV-DB leer ist
- keine serverseitige KI; Ollama wird ausschliesslich im Browser ueber die Loopback-Adresse des Besuchers angesprochen

Aufgaben-Dateianhaenge werden separat unter `data/task-attachments/` gespeichert. Dieses Verzeichnis muss zusammen mit der Datenbank extern gesichert und bei einer Migration wiederhergestellt werden; SQLite-/JSON-Backups und der JSON-Export enthalten nur die Verweise auf diese Dateien. Bereits eingebettete Alt-Anhaenge bleiben im JSON enthalten. Die mitgelieferte Nginx-Konfiguration erlaubt fuer den Upload-Endpunkt unbegrenzte Anfragegroessen; andere Proxys muessen entsprechend konfiguriert werden. Verfuegbarer Speicherplatz und Infrastruktur setzen weiterhin praktische Grenzen.

### Alternative: separater Static-Server

```bash
python -m http.server 8080
```

Hinweis: Fuer volle Funktion (Persistenz, KI, GitHub-Proxy) muss trotzdem `storage_server.py` laufen.

### Direkter Datei-Start

Datei [app.html](app.html) kann direkt geoeffnet werden, aber bei manchen Browsern fuehrt file:// zu Modul- oder CORS-Einschraenkungen. Fuer stabile Nutzung HTTP-Server verwenden.

### Aufgaben prüfen

Unter `#page=tasks` wechselt der Ansichtsumschalter zwischen allen Aufgaben, der Review-Warteschlange und erledigten Aufgaben. Die Karten zeigen Projekt, Zuweisung und Abschluss auf einen Blick. Über den Pfeil lassen sich Details und Verlauf öffnen; Review, Nacharbeit und Wiedereröffnung werden direkt in der Karte bestätigt.

### Team-Kalender

Über „Eintrag anlegen“ oder einen Doppelklick auf einen Kalendertag lassen sich Termine sowie Urlaub, Krankmeldungen und Homeoffice für ausgewählte Mitarbeiter erfassen. Ein optionales Enddatum ist einschließlich; mehrtägige Einträge sind ganztägig. Mitarbeiterstatus benötigen keine Teilnahmebestätigung und erscheinen an jedem Tag des Zeitraums sowie im iCal-Export. Bestehende Urlaubstermine ohne Statuskennzeichnung behalten ihre Einladungen.

Krankmeldungen sind für alle angemeldeten Nutzer in den gemeinsamen Kalenderdaten sichtbar; eine serverseitige Einschränkung auf einzelne Personen besteht nicht. Keine Diagnosen oder medizinischen Details erfassen. Der Kalender ersetzt keinen vertraulichen Melde- oder Genehmigungsprozess.

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

### Projektwissen und Hosting

Im rechten Bereich der Projektkarte führen Wissensdatei und Verwalten-Schaltfläche direkt zum vorhandenen Projektwissen. Im Dashboard öffnet die Schaltfläche eine Leseansicht mit Anhängen, Secrets, Notizen, Links, Schmierzettel und .env-Inhalt; sensible Werte werden erst auf Wunsch angezeigt. Die Bearbeitung des Projektwissens und der Hosting-Daten erfolgt auf der Projektseite. Hosting-Daten sind nach Server, Domain und DNS, SSL sowie Vertrag und Abrechnung gegliedert. Dort lassen sich unter anderem Anbieter, Tarif, Umgebung, Server, Registrar, Nameserver, DNS-Hinweise, Zertifikatsanbieter, Verlängerung, bezahlter Zeitraum, Rechnungsdatum, Betrag und Intervall manuell hinterlegen. Manuelle Termine werden innerhalb von 30 Tagen und nach Ablauf hervorgehoben.

Der Storage-Server prüft hinterlegte Live-URLs automatisch ungefähr alle fünf Minuten, solange er läuft. Angezeigt werden HTTP-Status, Antwortzeit, Zeitpunkt und die letzten Prüfungen; Fehler und veraltete Prüfungen erscheinen als Warnung. Die automatische DNS-Anzeige enthält die vom Server aufgelösten öffentlichen IP-Adressen des Live-Hosts, keine vollständige DNS-Zone oder Nameserver-Abfrage. Bei erfolgreicher HTTPS-Zertifikatsprüfung werden Aussteller, Name, Gültigkeit und TLS-Version angezeigt; bei Prüfungsfehlern sind diese Angaben nicht verfügbar. Nur öffentliche HTTP(S)-Ziele ohne Zugangsdaten sind zulässig; private IP-Adressen und Weiterleitungen werden nicht angefragt. Ein Weiterleitungsstatus bedeutet nicht, dass das Ziel erreichbar ist. Der Verlauf umfasst höchstens 48 Prüfungen je Projekt und wird in SQLite gespeichert; JSON-Exporte und die Wiederherstellung nur des KV-Speichers enthalten diesen Verlauf nicht.

Die Kacheln „Hosting & Server“ und „SSL / TLS“ zeigen die ermittelte IP beziehungsweise den Zertifikatsablauf direkt mit Prüfzeitpunkt an. Im Dashboard enthält „Hosting & Server“ außerdem Live-Status, Prüfverlauf, Screenshot und die verfügbaren Links; der Screenshot lässt sich vergrößern. Die DNS-IP kann zu einem Proxy oder CDN gehören und muss nicht die IP des Ursprungsservers sein. Manuell hinterlegte Server- und Zertifikatsdaten bleiben separat erhalten und werden nicht automatisch überschrieben.

Die bestehende Secret- und .env-Verwaltung speichert Inhalte unverschlüsselt, auch in Backups. Sie ist kein Passworttresor. Passwörter und Zugangsdaten sollten dort oder in URLs nicht hinterlegt werden; ein verschlüsselter Tresor erfordert eine HTTPS-Bereitstellung.

### 1) Ollama auf jedem Besucher-Rechner

```bash
ollama pull hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M
OLLAMA_ORIGINS="http://178.105.213.50,http://178.105.213.50:8766" ollama serve
```

`OLLAMA_ORIGINS` muss die Origin enthalten, unter der das Dashboard geoeffnet wird. Bei mehreren Origins werden die Werte kommasepariert angegeben. Das Frontend spricht ausschliesslich `http://127.0.0.1:11434` beziehungsweise `http://localhost:11434` auf dem Rechner des Besuchers an, sofern die App lokal geoeffnet wird.

Wichtig: Das ist ein Browser-zu-Localhost-Pattern. Der Browser kann nur auf die Ollama-Instanz des eigenen Rechners zugreifen. Wenn die App z.B. via `http://178.105.213.50` geoeffnet wird, kann sie nicht auf das lokale Ollama eines anderen Mitarbeiters auf dessen Rechner zugreifen. Für dieses Szenario muss der Live-Server den AI-Request an die Ollama-Instanz des Mitarbeiters weiterleiten. Dazu setzt der Server `OLLAMA_BASE_URL` auf die interne URL des Mitarbeiters, z.B. `http://192.168.1.42:11434`, und der Browser ruft die KI-Endpunkte auf derselben Origin des Live-Servers auf. Der Server leitet dann weiter an den Mitarbeiter-Rechner.

Beispiel: 

```bash
export OLLAMA_BASE_URL="http://192.168.1.42:11434"
export PROJECT_DASHBOARD_STORAGE_PORT="8766"
python3 storage_server.py
```

Auf dem Mitarbeiter-Rechner muss Ollama ebenfalls so gestartet werden, dass die Live-Server-Origin erlaubt ist:

```bash
OLLAMA_ORIGINS="http://178.105.213.50,http://178.105.213.50:8766" ollama serve
```

Bei Verwendung der Ollama-App unter macOS muss die Variable vor dem vollstaendigen Neustart der App gesetzt werden:

```bash
launchctl setenv OLLAMA_ORIGINS "http://178.105.213.50,http://178.105.213.50:8766"
```

### 2) Storage-Server starten

```bash
cd /Users/DNS/Projects/projekt-dashboard
python3 storage_server.py
```

Standard-Port ist 8766 (konfigurierbar ueber PROJECT_DASHBOARD_STORAGE_PORT).

Der Storage-Server startet und verwendet kein Ollama. Aufrufe an seine alten `/api/ai/*`-Routen werden mit HTTP 410 abgewiesen.

### 3) UI oeffnen

Beispiel:

- [http://127.0.0.1:8766/app.html](http://127.0.0.1:8766/app.html)

KI-Antworten werden direkt zwischen dem Browser und der lokalen Ollama-Instanz des Besuchers ausgetauscht. Der zentrale Server erhaelt weder Prompts noch KI-Antworten.

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
