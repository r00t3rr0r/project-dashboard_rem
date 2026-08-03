# KI Aufarbeitung

- Projekt-ID: test-project
- Projekt: Test Projekt
- Stufe: milestones-draft
- Modell: hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M
- Generiert am: 2026-08-02T02:42:14.668111Z

## Prompt

```
Du bist ein Senior Delivery Manager. Erzeuge fuer den Projektstart klare Meilensteine zur Ueberwachung von Ablauf und Fortschritt.

Projekt: Test Projekt
Status: planning

Kontextdaten (JSON):
{
  "projectStatus": "planning",
  "projectDescription": "",
  "meetingNotes": [],
  "conceptMarkdown": "",
  "planMarkdown": "",
  "tasksSummary": "",
  "queuedTaskCount": 0,
  "queuedEventCount": 0,
  "queuedTasks": [],
  "queuedEvents": []
}

Anforderungen:
- Liefere 3 bis 10 Meilensteine in realistischer Reihenfolge.
- Jeder Meilenstein braucht Titel, Datum (YYYY-MM-DD) und kurze Beschreibung.
- StartTime/EndTime optional als HH:MM, sonst leer.
- Nutze nur Informationen aus den Eingaben; keine erfundenen Fakten.

Antworte ausschliesslich als JSON-Objekt in exakt diesem Format:
{
  "summaryMarkdown": "...",
  "milestones": [
    {"title":"...","description":"...","date":"YYYY-MM-DD","startTime":"","endTime":"","type":"release"}
  ]
}
Nur JSON, kein Markdown-Codeblock, keine Vorrede.
```

## Ergebnis

Projekt 'Test Projekt' befindet sich im Planungsstatus. Da noch keine spezifischen Details vorliegen, wurden standardisierte Meilensteine für den Projektstart definiert.
