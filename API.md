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

Die Endpunkte `POST /api/project-knowledge`, `GET /api/ai/project-knowledge?projectId=...`, `POST /api/ai/project-knowledge` und `POST /api/ai/project-context` erfordern eine angemeldete Admin-Sitzung. `POST /api/project-knowledge` speichert `{projectId, projectTitle, markdown}` als Markdown und liefert `{ok, filePath, bytes}`. Der Inhalt darf nicht leer und höchstens 10 MiB groß sein. `GET /api/ai/project-knowledge` liest die im Projekt hinterlegte Datei.

Für Remote-Ollama erzeugt `POST /api/ai/project-knowledge` mit `analysisOnly: true` und `knowledgePrompt` einen Abschnitt und liefert `markdown` und `model`, ohne eine Datei zu schreiben. Die Projektoberfläche speichert die zusammengefügten Abschnitte erst nach erfolgreicher Erstellung. Admins können die Wissensdatei außerdem bearbeiten und KI-Ergänzungen für Weiterprogrammierung, Aufgaben, Systemlogik oder Fehleranalyse entwerfen; diese Entwürfe werden erst nach Prüfung und manuellem Speichern übernommen. Dabei wird ein begrenzter Auszug der Wissensdatei an den gewählten KI-Anbieter übertragen.

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
ueber eine einklappbare Anzahl einsehbar.
Fehler beim Laden der Branches oder einer Historie werden angezeigt; unvollstaendige
Ergebnisse werden nicht als vollstaendig ausgegeben. Bereits im Projekt
dokumentierte SHAs aus QuickTask oder AI Conf werden ausgelassen; nicht
ausgewaehlte Commits bleiben fuer einen spaeteren Abruf verfuegbar. Vor der
Uebersetzung zeigt eine Vorschau die Originalnachrichten, Autoren und Zeitpunkte.
Standardmaessig sind die neuesten 20 ausgewaehlt. Mit lokalem Zeitraum und
Anzahl kann die Auswahl neu gesetzt und danach einzeln angepasst werden; eine
leere Anzahl bedeutet alle Treffer. Erst die bestaetigte Auswahl wird uebersetzt. Ollama
uebersetzt die vollstaendige Nachricht unabhaengig von der Ausgangssprache,
auch aus dem Tuerkischen, nach Deutsch und Englisch. Fuer jeden lokalen
Commit-Tag entsteht eine eigene erledigte Aufgabe mit den ausgewaehlten Commits
als erledigten Teilaufgaben. Titel, Beschreibung und Teilaufgaben koennen pro
Tag bearbeitet werden. Der Titelvorschlag nutzt bis zu zwei verschiedene
deutsche Commit-Titel und verweist gegebenenfalls auf weitere; jede
Teilaufgabe muss die zugehoerige vollstaendige SHA enthalten. Planung, Aufwand,
Labels und hochgeladene Dateien gelten fuer jede Tagesaufgabe. Vor dem
Speichern muss jeder Commit einem zulaessigen Mitarbeiter zugeordnet werden.
Eine eindeutige Uebereinstimmung zwischen GitHub-Autorenlogin und
GitHub-Benutzername bzw. Profillink im Mitarbeiterprofil wird vorgeschlagen;
bei Commits ohne GitHub-Login wird ein eindeutig hinterlegter GitHub-Alias
exakt mit dem Commit-Autornamen verglichen. Automatisch hinterlegte
Mitarbeiternamen und Benutzernamen gelten dabei nicht als Commit-Aliase.
Commit-Autornamen sind frei waehlbar; Vorschlaege sollten daher geprueft werden.
Fehlende oder mehrdeutige Zuordnungen muessen manuell ausgewaehlt werden.
Im Mitarbeitermodus kann nur der angemeldete Mitarbeiter ausgewaehlt werden.
Die Tagesaufgabe wird allen zugeordneten Autoren des Tages zugewiesen, jede
Commit-Teilaufgabe dem jeweils ausgewaehlten Mitarbeiter. Die Beschreibung
enthaelt beide Uebersetzungen und das
Original. Die ausgewaehlten SHAs werden erst beim Erstellen gespeichert.
Unvollstaendige oder nicht eindeutig zuordenbare Uebersetzungen fuehren zu
einer Fehlermeldung. KI-Ausgaben bitte pruefen.

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
Fehlende, leere oder nicht eindeutig anhand der SHA zuordenbare Uebersetzungen
stoppen die Vorbereitung mit einer Fehlermeldung statt einer stillen Ersetzung.
Erst nach Pruefung und Auswahl oeffnet sich der vorausgefuellte Dialog
"Neue Aufgabe". Fuer jeden lokalen Commit-Tag wird eine eigene Projektaufgabe
mit `status: done`, `progress: 100` und erledigten Teilaufgaben
(`completed: true`) vorbereitet; Titel, Beschreibungen und Teilaufgaben sind
vor dem Speichern bearbeitbar.
Teilaufgaben enthalten beide Titel (`DE: ... · EN: ... [sha]`); die Beschreibung
enthaelt beide uebersetzten Nachrichten, das Original, SHA, Autor, Zeitpunkt und
GitHub-Link. Commits dokumentieren Aenderungen, nicht automatisch erfolgreiche
Tests oder Abnahmen. Bereits gespeicherte Aufgaben werden nicht umuebersetzt.

`task.githubCommitImport` speichert `repository`, `dailyTaskDate`, `shas` und
strukturierte `commits`; AI Conf speichert ausserdem den Abrufzeitpunkt `until`.
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

### Ollama-Modellrouting

"Auswahl & Fallback" wird als JSON im zentralen Key `pd_ai_configuration`
gespeichert. Der Client wartet auf `DataLayer.ready`, bevor er die Modellauswahl
liest, und sendet das ausgewaehlte Modell sowohl in `model` als auch in
`promptConfig.model` an den Server. Die Server-Endpunkte verwenden diese Auswahl.
Der Modus `fixed` erzwingt ausschliesslich das Primaermodell; die anderen Modi
duerfen das konfigurierte Fallback verwenden, wenn das Primaermodell fehlt oder
keine Textgenerierung unterstuetzt.

Die automatische Auswahl und die Modell-Selects schliessen reine Embedding-Modelle
aus (Ollama-Capabilities, bei aelteren Metadaten bekannte Embedding-Modellnamen).
Ein alter Speicherwert `[object Object]` enthaelt keine rekonstruierbaren
Modellnamen: Auswahl nach dem Update einmal erneut waehlen und speichern.

Regressionstests: `node --test scripts/test_local_ollama.js scripts/test_ai_conf_commits.js`.
