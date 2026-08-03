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

## Lokale KI API (Storage Server)

Diese Endpunkte werden vom Python-Server in `storage_server.py` bereitgestellt.
Standard-Adresse: `http://127.0.0.1:8766` (konfigurierbar via `PROJECT_DASHBOARD_STORAGE_PORT`).

### `GET /api/ai/health`

Prueft die Erreichbarkeit der lokalen Ollama-Instanz und liefert verfügbare Modelle.

### `POST /api/ai/project-knowledge`

Erzeugt aus Projektdaten eine lokale Wissensdatei fuer KI-gestuetzte Folgeaufgaben.

Request Body (Beispiel):

```json
{
  "projectId": "abc123",
  "projectTitle": "Kundenportal",
  "model": "llama3.1:8b",
  "github": { "url": "https://github.com/org/repo", "owner": "org", "repo": "repo" },
  "snapshot": { "project": {}, "tasks": [], "releases": [], "events": [] }
}
```

Response (Beispiel):

```json
{
  "ok": true,
  "projectId": "abc123",
  "model": "llama3.1:8b",
  "generatedAt": "2026-07-30T12:00:00.000Z",
  "filePath": "/data/project-knowledge/abc123-kundenportal-ki-wissen.md",
  "bytes": 18273
}
```

### `GET /api/health`

Liefert Basis-Health plus Bootstrap-Status beim Serverstart.

Response (Beispiel):

```json
{
  "status": "ok",
  "db": "/abs/path/data/projekt-dashboard.sqlite",
  "knowledgeDir": "/abs/path/data/project-knowledge",
  "bootstrap": {
    "dbRestore": { "restored": false, "source": "db", "rows": 13 },
    "ollama": { "status": "ok", "autostart": true, "detail": "already-running" }
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
