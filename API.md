# Projekt-Dashboard — Public API Referenz

Alle öffentlichen APIs sind über `window.DataLayer` erreichbar.  
Jede Funktion nutzt localStorage als Persistenzschicht.

---

## Projects (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getProjects()` | — | → `Project[]` | Alle Projekte zurückgeben |
| `createProject(project)` | `project: Project` | → `Project` | Neues Projekt erstellen (ID + createdAt automatisch) |
| `getProjectById(id)` | `id: string` | → `Project\|null` | Projekt nach ID suchen |
| `updateProject(project)` | `project: Project` | → `boolean` | Projekt aktualisieren (true wenn gefunden) |
| `deleteProject(id)` | `id: string` | → `boolean` | Projekt löschen (true wenn gefunden) |

**Beispiel:**

```js
var p = window.DataLayer.createProject({ name: 'Website Relaunch', description: 'Neues Frontend' });
console.log(p.id); // "m3x7kq..."
window.DataLayer.deleteProject(p.id);
```

---

## Tasks (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getTasks()` | — | → `Task[]` | Alle Tasks zurückgeben |
| `getTasksFiltered(filter)` | `filter: object` | → `Task[]` | Tasks mit Filtern (projectId, status, labelIds[], assigneeId[]) |
| `createTask(task)` | `task: Task` | → `Task` | Neue Task erstellen (ID + createdAt automatisch) |
| `getTaskById(id)` | `id: string` | → `Task\|null` | Task nach ID suchen |
| `updateTask(task)` | `task: Task` | → `boolean` | Task aktualisieren |
| `deleteTask(id)` | `id: string` | → `boolean` | Task löschen |

**Beispiel:**

```js
var filter = { status: 'in-progress', assigneeId: ['emp-123'] };
var tasks  = window.DataLayer.getTasksFiltered(filter);

var t = window.DataLayer.createTask({ title: 'API endpoint', priority: 'high' });
window.DataLayer.updateTask({ ...t, status: 'review' });
```

---

## Employees (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getEmployees()` | — | → `Employee[]` | Alle Mitarbeiter zurückgeben |
| `createEmployee(employee)` | `employee: Employee` | → `Employee` | Neuen Mitarbeiter erstellen |
| `getEmployeeById(id)` | `id: string` | → `Employee\|null` | Mitarbeiter nach ID suchen |
| `updateEmployee(employee)` | `employee: Employee` | → `boolean` | Mitarbeiter aktualisieren |
| `deleteEmployee(id)` | `id: string` | → `boolean` | Mitarbeiter löschen |

Zusatzfelder im `Employee`-Objekt werden unverändert persistiert. Fuer GitHub-Verknuepfungen nutzt die Mitarbeiteransicht ein `github`-Objekt mit `username`, `profileUrl`, `aliases`, `lastSyncedAt`, `syncStatus` und `syncError`.

---

## Labels (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getLabels()` | — | → `Label[]` | Alle Labels zurückgeben |
| `createLabel(label)` | `label: Label` | → `Label` | Neues Label erstellen (default color #4a9eff) |
| `getLabelById(id)` | `id: string` | → `Label\|null` | Label nach ID suchen |
| `updateLabel(label)` | `label: Label` | → `boolean` | Label aktualisieren |
| `deleteLabel(id)` | `id: string` | → `boolean` | Label löschen |

---

## Templates (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getTemplates()` | — | → `Template[]` | Alle Vorlagen zurückgeben |
| `createTemplate(template)` | `template: Template` | → `Template` | Neue Vorlage erstellen |
| `getTemplateById(id)` | `id: string` | → `Template\|null` | Vorlage nach ID suchen |
| `updateTemplate(template)` | `template: Template` | → `boolean` | Vorlage aktualisieren |
| `deleteTemplate(id)` | `id: string` | → `boolean` | Vorlage löschen |

---

## Releases (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getReleases()` | — | → `Release[]` | Alle Releases zurückgeben |
| `createRelease(release)` | `release: Release` | → `Release` | Neues Release erstellen (default status 'draft') |
| `getReleaseById(id)` | `id: string` | → `Release\|null` | Release nach ID suchen |
| `updateRelease(release)` | `release: Release` | → `boolean` | Release aktualisieren |
| `deleteRelease(id)` | `id: string` | → `boolean` | Release löschen |

---

## Notifications (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getNotifications()` | — | → `Notification[]` | Alle Benachrichtigungen zurückgeben |
| `createNotification(notification)` | `notification: Notification` | → `Notification` | Neue Benachrichtigung (createdAt + read=false automatisch) |
| `markNotificationRead(id)` | `id: string` | → `boolean` | Als gelesen markieren |
| `deleteNotification(id)` | `id: string` | → `boolean` | Benachrichtigung löschen |

---

## Calendar Events (CRUD)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `getCalendarEvents()` | — | → `CalendarEvent[]` | Alle Kalenderereignisse zurückgeben |
| `createCalendarEvent(event)` | `event: CalendarEvent` | → `CalendarEvent` | Neues Ereignis erstellen |
| `getCalendarEventById(id)` | `id: string` | → `CalendarEvent\|null` | Ereignis nach ID suchen |
| `updateCalendarEvent(event)` | `event: CalendarEvent` | → `boolean` | Ereignis aktualisieren |
| `deleteCalendarEvent(id)` | `id: string` | → `boolean` | Ereignis löschen |

---

## Import / Export

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `exportJSON()` | — | → `boolean` | Daten als JSON-Datei herunterladen |
| `importJSON(file)` | `file: File` | → `Promise<boolean>` | JSON-Datei importieren (alle 8 Domains) |
| `resetAll()` | — | → `void` | Alle Daten leeren |

**Beispiel:**

```js
// Export starten
window.DataLayer.exportJSON();

// Import per Code
var file = new File(['{"projects":[{"name":"Test"}]}'], 'import.json', { type: 'application/json' });
window.DataLayer.importJSON(file).then(function(ok) { console.log('Import OK:', ok); });
```

---

## Event Bus (Pub/Sub)

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `on(event, callback)` | `event: string, cb: Function` | → `void` | Event-Listener registrieren |
| `emit(event, ...args)` | `event: string, ...args: any[]` | → `void` | Event feuern (alle Listener aufrufen) |

**Beispiel:**

```js
window.DataLayer.on('dataChanged', function() {
  console.log('Daten wurden geändert!');
});

// Interne Module rufen emit('dataChanged') nach CRUD-Operationen.
```

---

## Utility

| Funktion | Parameter | Typ | Beschreibung |
|----------|-----------|-----|--------------|
| `generateId()` | — | → `string` | Eindeutige ID generieren (timestamp + random) |

---

## Storage HTTP API

Geschuetzte Storage-Endpunkte erwarten ein gueltiges HttpOnly-Sitzungscookie. `POST /api/auth/login` akzeptiert `username`, `password` und optional `remember` (Boolean). Ohne `remember` gilt die Sitzung maximal acht Stunden, mit `remember: true` bis zu 30 Tage. `GET /api/auth/session` prueft und `POST /api/auth/logout` widerruft die Sitzung. Der oeffentliche Endpunkt `GET /api/auth/users` liefert nur `name` und `username` freigeschalteter Konten fuer die Login-Auswahl. Admin-PIN-Header und PIN-Queryparameter werden nicht mehr akzeptiert. Der Browser verwendet den Vollsnapshot beim Start und nach einer Wiederverbindung; laufende SSE-Aenderungen werden gezielt pro Storage-Key geladen.

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET /api/kv` | Vollstaendiger KV-Snapshot mit ETag-/Gzip-Unterstuetzung |
| `GET /api/kv?key=pd_tasks` | Einzelwert als `{ key, exists, value, updatedAt }` |
| `POST /api/kv` | Wert setzen/loeschen oder Storage leeren |
| `GET /api/kv/stream` | SSE-Ereignisse mit `action`, `key`, `seq` und `updatedAt` |

Schnelle Ereignisfolgen werden clientseitig je Key zusammengefuehrt und geordnet abgearbeitet. `clear` und unbekannte Ereignisse fallen auf einen Vollsnapshot zurueck.

---

## Lokale KI API (Besucher-Rechner)

Bei lokal geöffnetem Dashboard laufen Ollama-Anfragen direkt an `http://127.0.0.1:11434` beziehungsweise `http://localhost:11434`; bei Remote-Zugriff werden sie über die KI-Endpunkte des Storage-Servers weitergeleitet. Claude und ChatGPT werden vom Browser direkt aufgerufen.

### `GET http://127.0.0.1:11434/api/tags`

Prueft aus dem Browser die Erreichbarkeit der lokalen Ollama-Instanz und liefert verfuegbare Modelle.

### `POST http://127.0.0.1:11434/api/generate`

Führt lokale Ollama-Generierungen im Browser aus.

Request Body (Beispiel):

```json
{
  "model": "llama3.1:8b",
  "prompt": "Erstelle einen Projektplan ...",
  "stream": false,
  "format": "json",
  "options": { "temperature": 0.3, "num_predict": 1800 }
}
```

Response (Beispiel):

```json
{
  "model": "llama3.1:8b",
  "response": "...",
  "done": true
}
```

### Projektwissen speichern und lesen

Die Endpunkte `POST /api/project-knowledge`, `GET /api/ai/project-knowledge?projectId=...`, `POST /api/ai/project-knowledge` und `POST /api/ai/project-context` erfordern eine angemeldete Admin-Sitzung. `POST /api/project-knowledge` speichert `{projectId, projectTitle, markdown}` als Markdown und liefert `{ok, filePath, bytes}`. Der Inhalt darf nicht leer und höchstens 10 MiB groß sein. `GET /api/ai/project-knowledge` liest die im Projekt hinterlegte Datei. `GET /api/project-knowledge/draft?projectId=...&scope=...` und `POST /api/project-knowledge/draft` (Admin) speichern den Zwischenstand der KI-Erstellung serverseitig (`{projectId, scope, items}` bzw. `{projectId, clear:true}`). Unveränderte Abschnitte werden auch nach erfolgreichen Läufen wiederverwendet. `scope` besteht aus Anbieter, Modell und Repository; nach erfolgreichem Speichern ersetzt `{projectId, scope, items, replace:true}` den Zwischenstand durch die aktuell verwendeten Abschnitte.

Der Lese-Endpunkt unterstützt sowohl aktuelle relative Dateiverknüpfungen als auch ältere Verknüpfungen mit führendem `/`. Fehlt die hinterlegte Datei tatsächlich, meldet er 404 mit einem Hinweis auf die Wiederherstellung; die Aktualisierung ersetzt sie nicht automatisch.

Für Remote-Ollama erzeugt `POST /api/ai/project-knowledge` mit `analysisOnly: true` und `knowledgePrompt` einen Abschnitt und liefert `markdown` und `model`, ohne eine Datei zu schreiben. Die Projektoberfläche speichert die zusammengefügten Abschnitte erst nach erfolgreicher Erstellung. Admins können die Wissensdatei außerdem bearbeiten und KI-Ergänzungen für Weiterprogrammierung, Aufgaben, Systemlogik oder Fehleranalyse entwerfen; diese Entwürfe werden erst nach Prüfung und manuellem Speichern übernommen. Dabei wird ein begrenzter Auszug der Wissensdatei an den gewählten KI-Anbieter übertragen.

Mit zusätzlich `stream: true` liefert der Admin-Endpunkt bei `analysisOnly` UTF-8-NDJSON: `{"type":"delta","text":"..."}`, gefolgt von `{"type":"done","model":"..."}` oder `{"type":"error","error":"...","code":"..."}`. Nach Streambeginn werden Fehler im Stream gemeldet; ohne `done` ist die Antwort unvollständig. Die Oberfläche zeigt Text sofort an, übernimmt aber nur vollständig abgeschlossene Abschnitte in die Wissensdatei.

Für die Erstellung ruft die Oberfläche über den GitHub-Commit-Endpunkt alle Seiten des Branches `main` ab. Sie übergibt die 25 neuesten Commits nach Committer-Datum im Projektkontext an den KI-Anbieter. Fehlt `main` oder schlägt der Abruf fehl, bricht die Erstellung ab; der gespeicherte Commit-Sync wird nicht verändert. Der Dateibaum stammt weiterhin vom Standardbranch.

Vor einer Aktualisierung liest die Oberfläche die vorhandene Wissensdatei vollständig. Ein markierter automatischer Bereich wird ersetzt, solange er nicht manuell verändert wurde; übrige Inhalte und manuell veränderte automatische Bereiche bleiben erhalten. Bei älteren Dateien ohne Markierung wird der automatische Bereich ergänzt. Die bisherigen Inhalte werden nicht automatisch durch die KI mit den neuen Daten abgeglichen. Lesefehler, ungültige Markierungen oder vor dem Speichern erkannte zwischenzeitliche Änderungen verhindern die Speicherung.

Die Oberfläche verwendet dafür `promptConfig: {temperature: 0.2, maxTokens: 4096, contextTokens: 8192}`. Das eigene Antwortbudget wird bei Projektwissen nicht durch das globale Budget ersetzt. Der Server reserviert 1024 Tokens und prüft konservativ `UTF-8-Bytes(knowledgePrompt) + maxTokens + 1024 <= 8192`; Ollama erhält `num_ctx=8192`. Fehler enthalten zusätzlich `code: "AI_CONTEXT_LIMIT"` oder `code: "AI_OUTPUT_TRUNCATED"`, wenn eine kleinere Eingabe erforderlich ist. Der Client halbiert betroffene Chunks mit begrenzter Wiederholung. Andere Fehler werden nicht automatisch wiederholt.

### `GET /api/health`

Liefert Basis-Health plus Bootstrap-Status beim Serverstart.

Response (Beispiel):

```json
{
  "status": "ok",
  "db": "/abs/path/data/projekt-dashboard.sqlite",
  "knowledgeDir": "/abs/path/data/project-knowledge",
  "bootstrap": {
    "dbRestore": { "restored": false, "source": "db", "rows": 13 }
  }
}
```

## GitHub Proxy API (Storage Server)

Fuer GitHub-Importe und private Repositories nutzt das Frontend den lokalen Proxy.
Optional kann ein Token pro Request via Header `X-GitHub-Token` uebergeben werden.

### `GET /api/github/repo?owner=<owner>&repo=<repo>`

Liefert Repository-Metadaten analog GitHub REST API v3.

### `GET /api/github/commits?owner=<owner>&repo=<repo>&per_page=100`

Liefert Commit-Liste analog GitHub REST API v3.

Parameter:

- `owner` (required)
- `repo` (required)
- `per_page` (optional, 1..100)
- `page` (optional, ab 1)
- `since`, `until` (optional, ISO-8601-Zeitstempel; werden an GitHub weitergegeben)
- `sha` (optional, Branchname oder SHA, ab dem Commits gelistet werden)

### `GET /api/github/branches?owner=<owner>&repo=<repo>&page=1`

Liefert die Branch-Liste (100 pro Seite) analog GitHub REST API v3.

### GitHub-Commits in QuickTask

Im Dialog "Neue Aufgabe" laedt "Neue GitHub-Commits abrufen" alle Seiten der
Historien aller Repository-Branches bis zum Abrufzeitpunkt. Gemeinsame Commits
werden anhand ihrer SHA zusammengefasst; ihre Branches sind in der Vorschau
ueber einen Tooltip und eine einklappbare Anzahl einsehbar.
Fehler beim Laden der Branches oder einer Historie werden angezeigt; unvollstaendige
Ergebnisse werden nicht als vollstaendig ausgegeben. Bereits im Projekt
dokumentierte SHAs aus QuickTask oder AI Conf werden ausgelassen; nicht
ausgewaehlte Commits bleiben fuer einen spaeteren Abruf verfuegbar. Vor der
Uebersetzung zeigt eine Vorschau die Originalnachrichten, Autoren und Zeitpunkte.
Standardmaessig sind die neuesten 20 ausgewaehlt. Mit lokalem Zeitraum und
Anzahl kann die Auswahl neu gesetzt und danach einzeln angepasst werden; eine
leere Anzahl bedeutet alle Treffer. Erst die bestaetigte Auswahl wird uebersetzt.
Alle ausgewaehlten Commits werden als Teilaufgaben einer gemeinsamen Aufgabe
vorbereitet, unabhaengig von Tag, Autor und Branch. Pro Commit wird der erste
zugehoerige Feature-Branch in der von GitHub gelieferten Reihenfolge verwendet;
bei Commits nur auf dem Standard-Branch wird dieser verwendet. Der erste
Feature-Branch der Auswahl bestimmt den Titel einer neuen Aufgabe; ohne
Feature-Branch werden uebersetzte Commit-Titel vorgeschlagen. Branch-Zugehoerigkeit
belegt nicht, wo ein Commit urspruenglich erstellt wurde. Spaetere Importe
verwenden eine passende Aufgabe des Projekts und Repositorys wieder. Passen
mehrere Aufgaben, muss eine Zielaufgabe gewaehlt werden; Branch-Zuordnungen
anderer Aufgaben bleiben erhalten. Bestehende Aufgaben behalten Titel und Status,
alte Tagesaufgaben bleiben unveraendert. Ist der Standard-Branch im Projekt
nicht hinterlegt, wird er ueber GitHub ermittelt.
Im Arbeitsfluss sind die zugeordneten Commits an ihren jeweiligen Tagen sichtbar;
ein Commit belegt keine Arbeitsdauer. Ollama
uebersetzt die vollstaendige Nachricht unabhaengig von der Ausgangssprache,
auch aus dem Tuerkischen, nach Deutsch und Englisch. Neue Aufgaben werden als
erledigt angelegt; Commits werden erledigte Teilaufgaben.
Der Titelvorschlag ohne Feature-Branch nutzt bis zu zwei verschiedene deutsche
Commit-Titel und verweist gegebenenfalls auf weitere; jede Teilaufgabe muss die
zugehoerige vollstaendige SHA enthalten. Planung, Aufwand, Labels und
hochgeladene Dateien gelten fuer neu angelegte Aufgaben. Vor dem
Speichern muss jeder Commit einem zulaessigen Mitarbeiter zugeordnet werden.
Eine eindeutige Uebereinstimmung zwischen GitHub-Autorenlogin und
GitHub-Benutzername bzw. Profillink im Mitarbeiterprofil wird vorgeschlagen;
bei Commits ohne GitHub-Login wird ein eindeutig hinterlegter GitHub-Alias
exakt mit dem Commit-Autornamen verglichen. Automatisch hinterlegte
Mitarbeiternamen und Benutzernamen gelten dabei nicht als Commit-Aliase.
Commit-Autornamen sind frei waehlbar; Vorschlaege sollten daher geprueft werden.
Fehlende oder mehrdeutige Zuordnungen muessen manuell ausgewaehlt werden.
Im Mitarbeitermodus kann nur der angemeldete Mitarbeiter ausgewaehlt werden.
Die gemeinsame Aufgabe wird allen zugeordneten Autoren zugewiesen, jede
Commit-Teilaufgabe dem jeweils ausgewaehlten Mitarbeiter. Die Beschreibung
enthaelt beide Uebersetzungen und das
Original. Die ausgewaehlten SHAs werden erst beim Erstellen gespeichert.
Der Uebersetzungsverlauf zeigt Batch-Anfragen, einzelne Nachbearbeitungen und
den Fortschritt. Fehlende oder nicht eindeutig zuordenbare Ergebnisse werden
automatisch bis zu zweimal einzeln nachbearbeitet. Bleiben Fehler bestehen,
kann die Auswahl erneut gestartet werden; erfolgreiche Uebersetzungen werden
nicht erneut angefordert. KI-Ausgaben bitte pruefen.

### Erledigte Aufgaben aus GitHub (AI Conf)

Im operativen Assistenten ein mit GitHub verknuepftes Projekt auswaehlen und
"Erledigte Aufgaben aus GitHub" starten. Der Assistent laedt alle Seiten der
Commit-Historien aller Branches bis zum Abrufzeitpunkt und filtert
bereits dokumentierte SHAs aus. Nicht ausgewaehlte oder spaeter hinzugekommene
Commits bleiben dadurch auch bei aelterem Commit-Zeitpunkt verfuegbar. Private Repositories
verwenden den GitHub-Token des angemeldeten Mitarbeiters; der Token wird nicht
an die KI gesendet. Wie in QuickTask erscheint vor der Uebersetzung eine
Vorschau mit Auswahl nach lokalem Zeitraum, Anzahl und einzelnen Commits.
Standardmaessig sind die neuesten 20 ausgewaehlt.
Branch-Filter und Suche begrenzen die Anzeige und die Uebersetzung auf sichtbare
ausgewaehlte Commits; ausgeblendete Auswahlen bleiben fuer einen spaeteren
Filterwechsel erhalten. Dies gilt auch fuer QuickTask.

Ollama uebersetzt jede ausgewaehlte vollstaendige Commit-Nachricht, auch aus dem Tuerkischen,
ins Deutsche und Englische und formuliert jeweils einen kurzen Aufgabentitel.
Die Vorschau zeigt beide Sprachen und das Original; alle Uebersetzungen koennen
vor der Uebernahme korrigiert werden. KI-Ausgaben koennen inhaltlich falsch oder
unvollstaendig sein, besonders mit kleinen Modellen, und muessen geprueft werden.
Wie in QuickTask zeigt ein Fortschrittsbalken den Verlauf einschliesslich
automatischer Einzelversuche. Bleiben fehlende, leere oder nicht eindeutig
zuordenbare Uebersetzungen bestehen, werden die betroffenen SHAs und Fehler
angezeigt. Bei erneutem Versuch werden nur noch offene Commits angefordert.
Erfolgreiche Ergebnisse werden pro Benutzer, Projekt, Repository und SHA lokal
im Browser zwischengespeichert und auch nach Neuladen oder erneutem Oeffnen
wiederverwendet, solange die Commit-Nachricht unveraendert ist. Beim Loeschen
der Browserdaten geht dieser Zwischenspeicher verloren; Aufgaben werden erst
beim Speichern angelegt. Ist der Browserspeicher nicht verfuegbar, erscheint
eine Warnung und die Ergebnisse bleiben nur bis zum Neuladen im Arbeitsspeicher.
Erst nach Pruefung und Auswahl oeffnet sich der vorausgefuellte Dialog
"Neue Aufgabe". Die KI ordnet die ausgewaehlten Commits anhand ihrer Inhalte
themenbezogen zu, auch ueber Autoren, Tage und Branches hinweg. Ein zweiter
Abgleich kann zusammengehoerige Themen und Einzelcommits aus verschiedenen
Batches zusammenfuehren; unsichere Vorschlaege bleiben getrennt. Die KI erstellt
pro Thema einen zusammenfassenden Titel und eine Beschreibung auf Deutsch und
Englisch. Die Vorschau zeigt die vorgeschlagene Zuordnung; Themen koennen
abgewaehlt und Zusammenfassungen sowie Commit-Uebersetzungen bearbeitet werden.
Eine falsche Zuordnung kann durch eine andere Commit-Auswahl und erneute
Ausfuehrung korrigiert werden. Fuer Commits ohne eindeutiges Thema, etwa bei
fehlenden, widerspruechlichen oder unbekannten KI-Zuordnungen, entsteht jeweils
eine gekennzeichnete Einzelaufgabe mit den bereits uebersetzten Commit-Titeln
und -Nachrichten. Der Commit wird deren erledigte Teilaufgabe. Zusaetzliche
Zuordnungen ohne passenden Commit werden gemeldet und ignoriert. Anfragefehler
oder unvollstaendige Zusammenfassungen werden weiterhin angezeigt; erfolgreiche
Commit-Uebersetzungen bleiben fuer einen erneuten Versuch zwischengespeichert.

Die KI schlaegt pro Aufgabe anhand der Commit-Inhalte Labels vor, darunter
Frontend, Backend, UX und Datastructure sowie vorhandene Labels. Vorschlaege
koennen in der Vorschau und fuer jede Aufgabe im Speicherdialog angepasst
werden. Vorhandene Labels werden unabhaengig von Gross-/Kleinschreibung
wiederverwendet; ausgewaehlte fehlende Standardlabels werden beim Speichern
angelegt. Aufgaben speichern die Label-IDs. Wenn die Label-Speicherung
fehlschlaegt, werden keine Aufgaben angelegt und der Fehler wird angezeigt.

Pro ausgewaehltem Thema entsteht eine neue Aufgabe mit erledigten
Commit-Teilaufgaben (`completed: true`), `status: done` und `progress: 100`.
Auch bei gemeinsamen Branches werden bestehende Aufgaben nicht automatisch
erweitert. Die thematische Zuordnung bezieht sich auf die aktuelle Auswahl;
spaetere Importe erzeugen neue Aufgaben. Titel, Beschreibung und Teilaufgaben
sind vor dem Speichern bearbeitbar. Pro Commit ist ein Mitarbeiter zuzuordnen;
Vorschlaege funktionieren wie bei QuickTask. Jede Teilaufgabe enthaelt beide
Commit-Titel und die vollstaendige SHA. Die Beschreibung enthaelt die
Zusammenfassung, beide uebersetzten Nachrichten und das Original, SHA, Autor,
Zeitpunkt und GitHub-Link. Commits dokumentieren Aenderungen, nicht automatisch
erfolgreiche Tests oder Abnahmen. Bereits gespeicherte Aufgaben werden nicht
umuebersetzt.

`task.githubCommitImport` speichert `repository`, `taskBranches`, `multiDayCommits`,
`shas` und strukturierte `commits`; AI Conf speichert ausserdem den Abrufzeitpunkt
`until`. Thematische AI-Conf-Aufgaben hinterlegen keine Branch-Zielzuordnung,
die Branches einzelner Commits bleiben erhalten. Bei aelteren Importen bleiben
`dailyTaskDate` und `taskBranch` lesbar.
Beim Speichern entsteht pro ausgewaehltem Commit ein
mit der Aufgabe verknuepfter Kalendereintrag fuer den Arbeitsfluss. Datum und
Uhrzeit entsprechen dem GitHub-Committer-Zeitpunkt in der lokalen Zeitzone des
importierenden Browsers und bleiben danach unveraendert. Der Eintrag nennt den
GitHub-Autor und die gewaehlte Mitarbeiterzuordnung und dokumentiert keine
Arbeitsdauer. Im Mitarbeiterfilter erscheint er nur beim zugeordneten
Mitarbeiter. Es werden keine Termineinladungen erzeugt. Eintraege
werden mit der Aufgabe synchronisiert und beim Loeschen der Aufgabe entfernt.
Die Terminansicht und der ICS-Export enthalten keine Commit-Dokumentation.
Aufgaben erscheinen dort nur mit ihren separat gesetzten Terminen
(Zeitraum, Deadline, fester Termin oder umgehend).
Im Arbeitsfluss werden Commits ebenfalls pro Projekt und Commit-Tag gebuendelt
und nach Mitarbeiter gefiltert; die drei neuesten sind direkt sichtbar, weitere
aufklappbar. Die rueckwirkende Dokumentation erzeugt keinen kuenstlichen
Fortschrittsgewinn. Andere Aufgabenaktivitaeten bleiben separat sichtbar.
Kalenderfelder und Detailkarten im Arbeitsfluss zeigen das zugehoerige Projekt
auch fuer andere Aufgaben sichtbar an; nicht zugeordnete Aufgaben sind als
"Ohne Projekt" gekennzeichnet.
Das tatsaechliche Erstellungsdatum der Aufgabe bleibt erhalten. Die
Tagesaufgaben werden gemeinsam gespeichert; ein Speicherfehler wird im
Aufgabendialog angezeigt. Die Aufgaben- und Kalenderdaten sind separate
Speicherschluessel und daher keine gemeinsame Datenbanktransaktion.
Fruehere Importe ohne strukturierte Commit-Daten werden nicht nachgetragen.
Bestehende Import-Aufgaben werden nicht automatisch neu zugeordnet.
Bereits ueber diese Funktion importierte SHAs werden fuer dasselbe Projekt und
Repository beim Abruf und vor der Uebernahme ausgefiltert. Das ist kein
serverseitiger Eindeutigkeitsschutz gegen gleichzeitige Importe mehrerer Nutzer.

Regressionstests: `node --test scripts/test_quicktask_github_commits.js scripts/test_ai_conf_commits.js` und
`python3 -m unittest scripts.test_storage_concurrency.GitHubCommitQueryTest`.
Nach Serveraenderungen den Storage-Server neu starten.

### Modellrouting

"Auswahl & Fallback" wird als JSON im zentralen Key `pd_ai_configuration`
gespeichert. Der Client wartet auf `DataLayer.ready`, bevor er die Modellauswahl
liest. Primaer- und Fallbackmodell werden pro Schnittstelle getrennt gespeichert;
alte Modellwerte werden fuer Ollama uebernommen. Ollama sendet das ausgewaehlte
Modell sowohl in `model` als auch in `promptConfig.model` an den Server.
Der Modus `fixed` erzwingt ausschliesslich das Primaermodell; die anderen Modi
duerfen das konfigurierte Fallback verwenden, wenn das Primaermodell fehlt oder
keine Textgenerierung unterstuetzt. Bei leerer Auswahl wird ein Modell aus der
aktuell geladenen Liste verwendet.

Ollama wird bei lokalem Dashboard direkt ueber Loopback angesprochen, bei
Remote-Zugriff ueber die konfigurierte Ollama-Instanz des Storage-Servers. Die
automatische Auswahl und die Modell-Selects schliessen reine Embedding-Modelle
aus (Ollama-Capabilities, bei aelteren Metadaten bekannte Embedding-Modellnamen).
Fuer Claude und ChatGPT laedt der Browser die Modellliste direkt vom jeweiligen
Anbieter mit dem API-Schluessel des angemeldeten Mitarbeiters. Claude-Seiten
werden vollstaendig abgerufen. Der Verbindungsstatus zeigt API- und
Netzwerkfehler an; die Modellabfrage bestaetigt keine erfolgreiche Generierung.
Die OpenAI-Modellliste enthaelt auch Modelle ohne Chat-Unterstuetzung, da die
Liste keine entsprechenden Faehigkeiten ausweist. Bei solchen Modellen zeigt die
Generierung den API-Fehler an. Fuer Claude ab 4.7 und Mythos sowie fuer OpenAI
GPT-5- und o-Modelle wird die nicht unterstuetzte Temperatureinstellung nicht
gesendet. Externe KI-Anbieter erhalten bei der Generierung
die jeweiligen Eingaben; sensible Inhalte vorher pruefen.
Ein alter Speicherwert `[object Object]` enthaelt keine rekonstruierbaren
Modellnamen: Auswahl nach dem Update einmal erneut waehlen und speichern.

Regressionstests: `node --test scripts/test_local_ollama.js scripts/test_ai_conf_commits.js`.
