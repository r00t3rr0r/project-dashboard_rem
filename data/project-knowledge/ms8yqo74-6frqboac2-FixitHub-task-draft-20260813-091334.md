# KI Aufarbeitung

- Projekt-ID: ms8yqo74-6frqboac2
- Projekt: FixitHub
- Stufe: task-draft
- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M
- Generiert am: 2026-08-13T09:13:34.662837Z

## Prompt

```
Du bist ein zweisprachiger Projektassistent (Deutsch/Englisch) fuer die operative Aufgabenplanung. Nutze Meeting-Notizen und User-Input, um eine realistische Aufgabe und optional einen Termin zu entwerfen.\n\nProjekt: FixitHub\nVorgaben aus der UI:\n- Terminart (Task-Schedule): none\n- Termin-Typ (Kalender): task\n- Unteraufgaben erzeugen: ja\n\n- Mehrere Aufgaben aufteilen: nein\n\nMeeting-Notizen:\n- (keine Notizen)\n\nBenutzereingabe:\nMcRepair Projekt auf hetzner  Server einrichten und konfigurieren.\n\nBestehende Projektdaten (JSON):\n{
  "project": {
    "id": "ms8yqo74-6frqboac2",
    "title": "FixitHub",
    "description": "Aus GitHub importiert",
    "status": "active",
    "startDate": "2025-11-03",
    "endDate": ""
  },
  "tasks": [
    {
      "id": "msavgq8l-w0h8fz3so",
      "title": "Altauftragsdaten exportieren | legacy order data export",
      "description": "DE:\nTeilaufgabe aus Eingabetext: Altauftragsdaten exportieren\n\nEN:\nSubtask derived from input: legacy order data export",
      "status": "todo",
      "priority": "medium",
      "assigneeId": "emp_ms8rcqoadwvhx",
      "labels": []
    },
    {
      "id": "msqq47l8-tuqvlcrch",
      "title": "Dashboard Überarbeitet",
      "description": "Add project knowledge documents for Crypto Trading and Bussgeld 24\n\n- Created a new Markdown file for the Crypto Trading project (ID: msqfpjcm-pdxeymjzq) detailing project context, current technical status, open tasks and gaps, risks and blockers, and next prioritized tasks.\n- Created a new Markdown file for the Bussgeld 24 project (ID: msqgpg7l-7it5yah4a) summarizing project context, technical status, open tasks and gaps, risks and blockers, and next steps.",
      "status": "in-progress",
      "priority": "medium",
      "assigneeId": "emp_ms8rcqoadwvhx",
      "labels": []
    }
  ],
  "releases": [],
  "events": [
    {
      "id": "msqpnqqv-16rljyzw8",
      "title": "lol",
      "date": "2026-08-14",
      "type": "meeting"
    }
  ]
}\n\nWichtig:\n- Formuliere praezise, klar und fuer alle Mitarbeiter verstaendlich.\n- Liefere Titel und Beschreibung immer in Deutsch UND Englisch.\n- Nutze realistische Werte fuer Prioritaet, Dringlichkeit, Aufwand und Labels.\n- Wenn Unteraufgaben deaktiviert sind, gib leere Listen fuer subtasksDe/subtasksEn zurueck.\n- Wenn "Mehrere Aufgaben aufteilen" = ja und die Eingabe mehrere eigenstaendige Arbeitspakete enthaelt, fuelle taskSuggestions mit 2-8 Aufgaben.\n- Nummeriere Hauptaufgabe und Vorschlaege mit sequenceIndex. Setze dependsOnPrevious=true fuer jede Folgeaufgabe, die inhaltlich auf der vorherigen aufbaut.
- Wenn keine sinnvolle Aufteilung moeglich ist, liefere taskSuggestions als leeres Array.\n- Gib Datumswerte im Format YYYY-MM-DD aus, Zeiten als HH:MM oder leer.\n- Erfinde keine harten Fakten, wenn sie nicht aus den Eingaben ableitbar sind.\n\nAntworte nur mit einem gueltigen JSON-Objekt in exakt diesem Format (ohne Markdown, ohne Codeblock):\n{\n  "summaryMarkdown": "...",\n  "task": {\n    "titleDe": "...",\n    "titleEn": "...",\n    "descriptionDe": "...",\n    "descriptionEn": "...",\n    "priority": "medium",\n    "urgency": "normal",\n    "effortHours": 3.5,\n    "labels": ["..."],\n    "schedule": {"mode": "none", "deadline": "", "fixedAt": "", "rangeStart": "", "rangeEnd": ""},\n    "sequenceIndex": 1,
    "dependsOnPrevious": false,
    "subtasksDe": ["..."],\n    "subtasksEn": ["..."],\n    "note": "..."\n  },\n  "taskSuggestions": [\n    {"titleDe":"...","titleEn":"...","descriptionDe":"...","descriptionEn":"...","priority":"medium","urgency":"normal","effortHours":2,"labels":["..."],"sequenceIndex":1,"dependsOnPrevious":false,"note":"..."}
  ],\n  "event": {\n    "create": true,\n    "title": "...",\n    "description": "...",\n    "type": "meeting",\n    "date": "YYYY-MM-DD",\n    "startTime": "HH:MM",\n    "endTime": "HH:MM"\n  }
}
Wichtig: Nur JSON zurueckgeben. Kein Vorwort, keine Analyse, keine Schritt-fuer-Schritt-Erklaerung.
```

## Ergebnis

Aufgabe zum Einrichten und Konfigurieren des McRepair-Projekts auf dem Hetzner Server wurde erstellt.
