# 🗄️ localStorage Schema-Dokumentation

Dieses Dokument beschreibt alle `localStorage`-Keys, die vom **DataLayer** (`data.js`) des Projekt-Dashboards verwendet werden.

---

## Namespace-Schema

Alle Schlüssel folgen dem Prefix-Schema:

```
pd_<collection>
```

| Prefix | Bedeutung              | Beispiel            |
|--------|------------------------|---------------------|
| `pd_`  | Projekt-Dashboard      | `pd_tasks`          |

Das Prefix verhindert Kollisionen mit anderen Anwendungen im selben Browser.

---

## Storage Keys Übersicht

### Kern-Sammlung (Arrays)

Alle folgenden Schlüssel speichern **JSON-encoded Arrays** (`[]`). Der Default-Wert bei leerem/ungültigem localStorage ist ein leeres Array `[]`.

| Key                      | Type       | Default | Beschreibung                                      |
|--------------------------|------------|---------|---------------------------------------------------|
| `pd_projects`            | `Project[]`      | `[]` | Liste aller Projekte                              |
| `pd_tasks`               | `Task[]`         | `[]` | Liste aller Tasks/Aufgaben                        |
| `pd_employees`           | `Employee[]`     | `[]` | Liste der Mitarbeiter/Teammitglieder              |
| `pd_labels`              | `Label[]`        | `[]` | Liste der Labels/Kategoriefarben                  |
| `pd_templates`           | `Template[]`     | `[]` | Liste der Task-Vorlagen                           |
| `pd_releases`            | `Release[]`      | `[]` | Liste der Releases                                |
| `pd_notifications`       | `Notification[]` | `[]` | Liste der Benachrichtigungen                      |
| `pd_calendar_events`     | `CalendarEvent[]`| `[]` | Liste der Kalenderereignisse                       |
| `pd_team_chat_messages`  | `TeamChatMessage[]` | `[]` | Öffentliche Nachrichten des Team-Gruppenchats  |

---

## Objekt-Strukturen

### TeamChatMessage

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `id` | `string` | Generierte Nachrichten-ID |
| `authorId` / `authorName` | `string` | Absender zum Erstellzeitpunkt |
| `targetType` | `string` | `all` oder `employee`; alle Nachrichten bleiben öffentlich sichtbar |
| `targetEmployeeId` / `targetEmployeeName` | `string` | Direkt angesprochener Mitarbeiter |
| `body` | `string` | Nachrichtentext |
| `replyToId` | `string` | ID der beantworteten Nachricht |
| `replyRequired` | `boolean` | Kennzeichnet eine verpflichtende Antwort |
| `requiredEmployeeIds` | `string[]` | Mitarbeiter, deren direkte Antwort noch ausgewertet wird |
| `createdAt` | `string` | ISO-8601 Timestamp |

### Project

| Feld           | Typ      | Beschreibung                          |
|----------------|----------|---------------------------------------|
| `id`           | `string` | UUID (generiert via generateId())     |
| `title`        | `string` | Projektname                           |
| `name`         | `string` | Alias für title                       |
| `description`  | `string` | Beschreibung                          |
| `createdAt`    | `string` | ISO-8601 Timestamp                    |
| `status`       | `string` | `planning` \| `active` \| `blocked` \| `done` |
| `progress`     | `number` | Manueller Projektfortschritt in Prozent (`0`-`100`) |
| `startDate`    | `string\|null` | Geplantes Startdatum              |
| `endDate`      | `string\|null` | Geplantes Enddatum                |
| `github`       | `object\|null` | Verknüpfung zur GitHub-Quelle      |
| `githubMetrics`| `object\|null` | Aggregierte Commit-Metriken        |
| `githubCommits`| `object[]` | Cache der letzten Commits            |
| `infoHub`      | `object` | Lokale Wissensobjekte (Links, Notizen, Attachments, Secrets, `.env`) |
| `meetingProtocol` | `object` | Meeting-Protokoll-Metadaten: `status` (`open` \| `closed`), `closedAt`, `updatedAt` |
| `aiKnowledge`  | `object` | Status/Metadaten für lokale KI-Aufbereitung via Ollama |
| `blocked`      | `boolean` | Kennzeichnet aktiven Projekt-Blocker |
| `blockedReason`| `string` | Aktueller Blocker-Grund |
| `blockedAt`    | `string` | Startzeit des aktiven Blockers (ISO-8601) |
| `blockedUntil` | `string` | Endzeit des letzten aktiven Blockers (ISO-8601) |
| `blockerTaskId`| `string\|null` | Verknuepfte Blocker-Aufgabe |
| `blockerHistory` | `object[]` | Historie von Blocker-Phasen (`reason`, `from`, `until`, `resolution`, `blockerTaskId`) |

### Task

| Feld          | Typ        | Beschreibung                                  |
|---------------|------------|-----------------------------------------------|
| `id`          | `string`   | UUID                                          |
| `title`       | `string`   | Aufgaben-Titel                                |
| `description` | `string`   | Beschreibung/Aufgabentext                     |
| `priority`    | `string`   | `"low"` \| `"medium"` \| `"high"` \| `"blocker"` |
| `status`      | `string`   | `"todo"` \| `"in-progress"` \| `"review"` \| `"done"` \| `"backlog"` |
| `projectId`   | `string\|null` | Verknüpftes Projekt-ID                    |
| `assigneeId`  | `string\|null` | Primaere Mitarbeiter-ID (erstes Element aus `assigneeIds`) |
| `assigneeIds` | `string[]` | Mehrfachzuweisung: alle zugeordneten Mitarbeiter-IDs |
| `labels`      | `string[]` | Array von Label-IDs                           |
| `urgency`     | `string`   | `"low"` \| `"normal"` \| `"high"` \| `"critical"` |
| `effortHours` | `number`   | Geplanter Aufwand in Stunden                  |
| `schedule`    | `object`   | Terminlogik: `mode`, `deadline`, `fixedAt`, `rangeStart`, `rangeEnd` |
| `timeTracking` | `object`  | Arbeitszeit/Pausenstatus: `totalMinutes`, `activeStartedAt`, `inProgressConfirmedAt`, `isPaused`, `pausedAt`, `pauseReasonPending`, `lastPauseReason`, `minutesByDate`, `pauseHistory` |
| `subtasks`    | `object[]` | Liste der Teilaufgaben (`id`, `title`, `completed`, `createdAt`) |
| `notes`       | `object[]` | Hinweise/Notizen zur Aufgabe (`id`, `text`, `createdAt`) |
| `attachments` | `object[]` | Datei-/Link-Hinweise (`id`, `name`, `url`, `type`, `addedAt`) |
| `createdAt`   | `string`   | ISO-8601 Timestamp                            |
| `updatedAt`   | `string`   | ISO-8601 Timestamp                            |
| `completedAt` | `string`   | ISO-8601 Abschlusszeitpunkt; wird beim Wiederöffnen geleert |
| `blocked`     | `boolean`  | Kennzeichnet aktive Blockierung der Aufgabe   |
| `blockedReason` | `string` | Aktueller Blocker-Grund                        |
| `blockedAt`   | `string`   | Startzeit des aktiven Blockers (ISO-8601)     |
| `blockedUntil`| `string`   | Endzeit des letzten aktiven Blockers (ISO-8601) |
| `blockerTaskId` | `string\|null` | Verknuepfte Blocker-Aufgabe          |
| `blockerHistory` | `object[]` | Historie von Blocker-Phasen (`reason`, `from`, `until`, `resolution`) |
| `isBlocker`   | `boolean`  | Kennzeichnet eine Aufgabe als Blocker-Eintrag |
| `blockedTargetType` | `string` | Zieltyp eines Blockers (`task` oder `project`) |
| `blockedTargetId` | `string` | Ziel-ID eines Blockers                     |
| `blockedTargetTitle` | `string` | Zieltitel eines Blockers               |
| `blockerResolvedAt` | `string` | Aufloesezeit eines Blockers (ISO-8601) |
| `blockerResolution` | `string` | Aufloesegrund bei Entblockung          |

### Employee

| Feld          | Typ      | Beschreibung                          |
|---------------|----------|---------------------------------------|
| `id`          | `string` | UUID                                  |
| `name`        | `string` | Name des Mitarbeiters                 |
| `role`        | `string` | Rolle/Funktion                        |
| `availability`| `string` | Verfuegbarkeitsstatus                 |
| `workplace`   | `string` | Allgemeiner Arbeitsort                |
| `dailyWorkStatus` | `object` | Tagesstatus: `date`, `workplace`, `note`, `sick`, `updatedAt` |
| `currentActivity` | `string` | Aktuelle Arbeit / Fokus           |
| `capacityPoints` | `number` | Verfuegbare Story-Points           |
| `focusAreas`  | `string[]` | Fachliche Schwerpunkte              |
| `github`      | `object` | GitHub-Verknuepfung: `username`, `profileUrl`, `privateAccessToken`, `aliases`, `lastSyncedAt`, `syncStatus`, `syncError` |
| `createdAt`   | `string` | ISO-8601 Timestamp                    |

`Project.githubCommits[]` kann optional angereicherte Autor-Metadaten enthalten: `authorLogin`, `authorProfileUrl`, `authorAvatarUrl`, `authorEmail`.

### Label

| Feld    | Typ      | Beschreibung                          |
|---------|----------|---------------------------------------|
| `id`    | `string` | UUID                                  |
| `name`  | `string` | Bezeichnung                           |
| `color` | `string` | Hex-Farbwert (Default: `#4a9eff`)     |

### Template

| Feld          | Typ      | Beschreibung                          |
|---------------|----------|---------------------------------------|
| `id`          | `string` | UUID                                  |
| `title`       | `string` | Vorlagen-Titel                        |
| `description` | `string` | Beschreibung                          |
| `createdAt`   | `string` | ISO-8601 Timestamp                    |

### Release

| Feld          | Typ      | Beschreibung                           |
|---------------|----------|----------------------------------------|
| `id`          | `string` | UUID                                   |
| `title`       | `string` | Release-Titel                          |
| `status`      | `string` | `"draft"` \| `"rc"` \| `"stable"` (Default: `"draft"`) |
| `createdAt`   | `string` | ISO-8601 Timestamp                     |

### Notification

| Feld          | Typ       | Beschreibung                           |
|---------------|-----------|----------------------------------------|
| `id`          | `string`  | UUID                                   |
| `message`     | `string`  | Benachrichtigungstext                  |
| `type`        | `string`  | `"info"` \| `"success"` \| `"warning"` \| `"error"` |
| `read`        | `boolean` | Lese-Status (Default: `false`)         |
| `createdAt`   | `string`  | ISO-8601 Timestamp                     |

### CalendarEvent

| Feld          | Typ      | Beschreibung                          |
|---------------|----------|---------------------------------------|
| `id`          | `string` | UUID                                  |
| `title`       | `string` | Event-Titel                           |
| `date`        | `string` | Datum (ISO-8601)                      |
| `createdAt`   | `string` | ISO-8601 Timestamp                    |

---

## DataLayer-API (`window.DataLayer`)

Die gesamte Datenzugriffsschicht ist über `window.DataLayer` im globalen Scope verfügbar.

### Generische CRUD-Funktionen (für jede Sammlung)

Für jede Datensammlung existiert ein konsistentes Set von Methoden:

| Methode                           | Beschreibung                                    |
|-----------------------------------|-------------------------------------------------|
| `getXxx()`                        | Alle Daten der Sammlung zurückgeben              |
| `createXxx(object)`               | Neues Objekt erstellen, ID + Timestamp auto-fill  |
| `getXxxById(id)`                  | Einzelnes Objekt via ID suchen                   |
| `updateXxx(object)`               | Bestehendes Objekt aktualisieren (ID erforderlich) |
| `deleteXxx(id)`                   | Objekt löschen                                   |

**Beispiele:**

```js
// Tasks
window.DataLayer.getTasks();
window.DataLayer.createTask({ title: 'Neue Aufgabe', priority: 'high' });
window.DataLayer.updateTask({ id: 'abc123', status: 'done' });
window.DataLayer.deleteTask('abc123');

// Employees
window.DataLayer.getEmployees();
window.DataLayer.createEmployee({ name: 'Max Mustermann', role: 'Developer' });

// Projects
window.DataLayer.getProjects();
window.DataLayer.createProject({ title: 'Projekt Alpha' });
```

### Task-spezifische Methoden

| Methode                 | Beschreibung                                    |
|-------------------------|-------------------------------------------------|
| `getTasksFiltered(filter)` | Tasks mit Filtern zurückgeben                |

**Filter-Objekt:**

```js
{
  projectId:  'string',      // Nur Tasks dieses Projekts
  status:     'string',      // Nur Tasks mit diesem Status
  labelIds:   ['id1', 'id2'],// Nur Tasks mit diesen Labels
  assigneeId: ['id1']        // Nur Tasks dieses Mitarbeiters
}
```

Sortierung: Höchste Priorität zuerst, dann nach `createdAt` absteigend.

### Notifications-spezifische Methoden

| Methode                      | Beschreibung                          |
|------------------------------|---------------------------------------|
| `createNotification(obj)`    | Neue Benachrichtigung (unten einfügen)|
| `markNotificationRead(id)`   | Als gelesen markieren                |
| `deleteNotification(id)`     | Löschen                               |

### Import / Export

| Methode                 | Beschreibung                                    |
|-------------------------|-------------------------------------------------|
| `exportJSON()`          | Lädt alle Daten als JSON-Datei herunter          |
| `importJSON(file)`      | Importiert Daten aus einer JSON-File (Promise)  |
| `resetAll()`            | Löscht ALLE Sammlungen (leert Arrays)           |

```js
// Export
window.DataLayer.exportJSON(); // Datei wird automatisch heruntergeladen

// Import
const fileInput = document.getElementById('import-input');
fileInput.addEventListener('change', function(e) {
  window.DataLayer.importJSON(e.target.files[0])
    .then(() => console.log('Import erfolgreich'))
    .catch(err => console.error('Import fehlgeschlagen:', err));
});

// Reset
window.DataLayer.resetAll(); // ⚠️ Alle Daten löschen!
```

### Event Bus (Publish/Subscribe)

| Methode              | Beschreibung                               |
|----------------------|--------------------------------------------|
| `on(event, callback)`| Listener für ein Event registrieren        |
| `emit(event, ...args)`| Event auslösen mit optionalen Argumenten  |

```js
// Event-Listener registrieren
window.DataLayer.on('task-created', function(task) {
  console.log('Neue Aufgabe:', task.title);
});

// Event auslösen (innerhalb DataLayer automatisch bei CRUD-Aktionen)
window.DataLayer.emit('data-changed');
```

### Utility

| Methode              | Beschreibung                               |
|----------------------|--------------------------------------------|
| `generateId()`       | Generiert eindeutige ID (`Date.now()..` + Random) |

---

## Datenfluss-Diagramm

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│   UI / DOM  │ ─────►  │  DataLayer API    │ ─────►  │ localStorage │
│  (app.html) │ ◄─────  │  (data.js)        │ ◄─────  │  (Browser)   │
└─────────────┘         └──────────────────┘         └──────────────┘
                               │                          │
                    ┌──────────▼──────────┐      ┌───────▼────────┐
                    │  Event Bus          │      │ Export/Import   │
                    │  emit / on()        │      │ JSON-Dateien    │
                    └─────────────────────┘      └────────────────┘

Datenfluss (CRUD):
1. User-Aktion → DOM-Event
2. Handler ruft DataLayer.createXxx() / updateXxx() / deleteXxx() auf
3. DataLayer schreibt JSON.stringify(data) in localStorage.setItem('pd_xxx', ...)
4. emit('data-changed') benachrichtigt alle Listener
5. UI-Module (kanban.js, dashboard.js etc.) reagieren via on('data-changed', ...)

Export:
DataLayer → JSON-Objekt → Blob → URL.createObjectURL() → Download-Aktion

Import:
File Input → FileReader.readAsText() → JSON.parse() → DataLayer.write() → localStorage
```

---

## ID-Generierung

IDs werden durch `generateId()` erzeugt und bestehen aus:

```
<Unix-Timestamp-in-base36>-<Zufallsstring>
```

Beispiel: `"m5xk2abc1-def4gh5ij"`

Das Format garantiert Eindeutigkeit bei sequentieller Erzeugung (selbe Millisekunde ≠ gleiche Zufallssequenz).

---

## Validierung

Der DataLayer führt folgende Validierungen durch:

- **`read(key, defaultVal)`**: Fängt JSON.parse-Fehler ab und gibt fallback zurück
- **`createXxx()`**: Setzt automatisch `id` (falls leer) und `createdAt` (ISO-8601)
- **`createTask()`**: Setzt Default `status: 'backlog'`
- **`createLabel()`**: Setzt Default `color: '#4a9eff'`
- **`createRelease()`**: Setzt Default `status: 'draft'`
- **`createNotification()`**: Setzt automatisch `read: false` und fügt vorne ein (`unshift`)

---

## Versionierung & Migration

Das Export-Format enthält Metadaten:

```json
{
  "version": "1.0",
  "exportedAt": "2026-07-30T10:49:00.000Z",
  "projects": [...],
  "tasks": [...],
  ...
}
```

Bei Import werden Arrays geprüft mit `Array.isArray()` — nicht-array-Felder werden ignoriert.

---

## Zusammenfassung der Keys

| Key                  | Collection        | CRUD            | Spezial               |
|----------------------|-------------------|-----------------|-----------------------|
| `pd_projects`        | Projekte          | +               | —                     |
| `pd_tasks`           | Tasks             | +, Filter       | Sortierung (Prio)     |
| `pd_employees`       | Mitarbeiter        | +              | —                     |
| `pd_labels`          | Labels            | +              | Default-Farbe         |
| `pd_templates`       | Vorlagen           | +              | —                     |
| `pd_releases`        | Releases          | +              | Default-Status        |
| `pd_notifications`   | Benachrichtigungen | +, read-mark    | unshift, Lese-Flag    |
| `pd_calendar_events` | Kalenderereignisse | +             | —                     |
