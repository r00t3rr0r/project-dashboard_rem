import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / 'data' / 'projekt-dashboard.sqlite'
JSON_PATH = ROOT / 'data' / 'project-data.json'


def iso(days_offset=0):
    return (datetime.now(timezone.utc) + timedelta(days=days_offset)).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def build_seed_payload():
    labels = [
        {'id': 'lbl-bug', 'name': 'Bug', 'color': '#d64550'},
        {'id': 'lbl-feature', 'name': 'Feature', 'color': '#4a9eff'},
        {'id': 'lbl-ops', 'name': 'Ops', 'color': '#10b981'},
        {'id': 'lbl-security', 'name': 'Security', 'color': '#8b5cf6'},
        {'id': 'lbl-docs', 'name': 'Docs', 'color': '#f59e0b'}
    ]

    employees = [
        {'id': 'emp-lea', 'name': 'Lea Wagner', 'role': 'Project Lead', 'availability': 'Verfuegbar', 'capacityPoints': 12, 'focusAreas': ['Planning', 'Stakeholder'], 'createdAt': iso(-30), 'updatedAt': iso(-1)},
        {'id': 'emp-tim', 'name': 'Tim Becker', 'role': 'Developer', 'availability': 'Belastet', 'capacityPoints': 10, 'focusAreas': ['Frontend', 'UX'], 'createdAt': iso(-28), 'updatedAt': iso(-1)},
        {'id': 'emp-sara', 'name': 'Sara Neumann', 'role': 'Developer', 'availability': 'Verfuegbar', 'capacityPoints': 11, 'focusAreas': ['Backend', 'API'], 'createdAt': iso(-27), 'updatedAt': iso(-1)},
        {'id': 'emp-jan', 'name': 'Jan Krueger', 'role': 'DevOps', 'availability': 'Verfuegbar', 'capacityPoints': 9, 'focusAreas': ['CI/CD', 'Infra'], 'createdAt': iso(-24), 'updatedAt': iso(-1)},
        {'id': 'emp-nina', 'name': 'Nina Fischer', 'role': 'QA', 'availability': 'Verfuegbar', 'capacityPoints': 8, 'focusAreas': ['Testing', 'Automation'], 'createdAt': iso(-22), 'updatedAt': iso(-1)},
        {'id': 'emp-omer', 'name': 'Omer Kaya', 'role': 'Designer', 'availability': 'Urlaub', 'capacityPoints': 7, 'focusAreas': ['UI', 'Prototyping'], 'createdAt': iso(-19), 'updatedAt': iso(-1)}
    ]

    projects = [
        {
            'id': 'prj-aurora',
            'title': 'Aurora Kundenportal',
            'name': 'Aurora Kundenportal',
            'description': 'Relaunch des Self-Service Portals mit SSO und neuem Dashboard.',
            'status': 'active',
            'startDate': iso(-40)[:10],
            'endDate': iso(30)[:10],
            'github': {'owner': 'example', 'repo': 'aurora-portal', 'url': 'https://github.com/example/aurora-portal'},
            'githubMetrics': {'totalCommits': 248, 'commitsLast7Days': 19, 'contributors': 7, 'avgCommitsPerWeek': 14.3, 'syncedAt': iso(-1)},
            'githubCommits': [
                {'sha': 'd13f3f1', 'message': 'feat: add sprint burndown widget', 'author': 'Tim Becker', 'date': iso(-2), 'url': 'https://github.com/example/aurora-portal/commit/d13f3f1'},
                {'sha': 'a77ce09', 'message': 'fix: harden oauth callback validation', 'author': 'Sara Neumann', 'date': iso(-5), 'url': 'https://github.com/example/aurora-portal/commit/a77ce09'}
            ],
            'infoHub': {
                'attachments': [],
                'notes': [{'id': 'note-aurora-1', 'text': 'Pilotkunde startet Abnahme in KW32.', 'createdAt': iso(-3)}],
                'links': [{'id': 'link-aurora-1', 'label': 'Figma', 'url': 'https://figma.com/example'}],
                'secrets': [],
                'scratchpad': 'Risiko: externe SSO-Abhaengigkeit.',
                'envText': 'API_BASE=https://api.example.local'
            },
            'aiKnowledge': {'preferredModel': 'llama3.1:8b', 'lastStatus': 'idle', 'lastGeneratedAt': '', 'filePath': '', 'lastError': '', 'lastModel': '', 'sourceCommitSha': '', 'lastKnowledgeSize': 0},
            'createdAt': iso(-40)
        },
        {
            'id': 'prj-mercury',
            'title': 'Mercury API Gateway',
            'name': 'Mercury API Gateway',
            'description': 'Zentrales API-Gateway mit Rate-Limits, Audit und Token-Rotation.',
            'status': 'active',
            'startDate': iso(-25)[:10],
            'endDate': iso(45)[:10],
            'github': {'owner': 'example', 'repo': 'mercury-gateway', 'url': 'https://github.com/example/mercury-gateway'},
            'githubMetrics': {'totalCommits': 122, 'commitsLast7Days': 11, 'contributors': 5, 'avgCommitsPerWeek': 9.7, 'syncedAt': iso(-1)},
            'githubCommits': [],
            'infoHub': {'attachments': [], 'notes': [], 'links': [], 'secrets': [], 'scratchpad': '', 'envText': ''},
            'aiKnowledge': {'preferredModel': 'llama3.1:8b', 'lastStatus': 'idle', 'lastGeneratedAt': '', 'filePath': '', 'lastError': '', 'lastModel': '', 'sourceCommitSha': '', 'lastKnowledgeSize': 0},
            'createdAt': iso(-25)
        },
        {
            'id': 'prj-orbit',
            'title': 'Orbit Monitoring',
            'name': 'Orbit Monitoring',
            'description': 'Unified Monitoring fuer Apps, Jobs und SLA Alerts.',
            'status': 'planning',
            'startDate': iso(-10)[:10],
            'endDate': iso(60)[:10],
            'github': None,
            'githubMetrics': None,
            'githubCommits': [],
            'infoHub': {'attachments': [], 'notes': [], 'links': [], 'secrets': [], 'scratchpad': '', 'envText': ''},
            'aiKnowledge': {'preferredModel': 'llama3.1:8b', 'lastStatus': 'idle', 'lastGeneratedAt': '', 'filePath': '', 'lastError': '', 'lastModel': '', 'sourceCommitSha': '', 'lastKnowledgeSize': 0},
            'createdAt': iso(-10)
        },
        {
            'id': 'prj-vulcan',
            'title': 'Vulcan Deploy Pipeline',
            'name': 'Vulcan Deploy Pipeline',
            'description': 'Pipeline-Haertung und Blue-Green Rollout fuer Produktion.',
            'status': 'blocked',
            'startDate': iso(-18)[:10],
            'endDate': iso(20)[:10],
            'github': {'owner': 'example', 'repo': 'vulcan-pipeline', 'url': 'https://github.com/example/vulcan-pipeline'},
            'githubMetrics': {'totalCommits': 44, 'commitsLast7Days': 2, 'contributors': 3, 'avgCommitsPerWeek': 4.0, 'syncedAt': iso(-2)},
            'githubCommits': [],
            'infoHub': {'attachments': [], 'notes': [{'id': 'note-vulcan-1', 'text': 'Firewall-Freigabe fuer Runner fehlt.', 'createdAt': iso(-4)}], 'links': [], 'secrets': [], 'scratchpad': '', 'envText': ''},
            'aiKnowledge': {'preferredModel': 'llama3.1:8b', 'lastStatus': 'idle', 'lastGeneratedAt': '', 'filePath': '', 'lastError': '', 'lastModel': '', 'sourceCommitSha': '', 'lastKnowledgeSize': 0},
            'createdAt': iso(-18)
        },
        {
            'id': 'prj-atlas',
            'title': 'Atlas Dokumentation',
            'name': 'Atlas Dokumentation',
            'description': 'Technische Dokumentation und Betriebsrunbooks.',
            'status': 'done',
            'startDate': iso(-60)[:10],
            'endDate': iso(-5)[:10],
            'github': None,
            'githubMetrics': None,
            'githubCommits': [],
            'infoHub': {'attachments': [], 'notes': [], 'links': [], 'secrets': [], 'scratchpad': '', 'envText': ''},
            'aiKnowledge': {'preferredModel': 'llama3.1:8b', 'lastStatus': 'idle', 'lastGeneratedAt': '', 'filePath': '', 'lastError': '', 'lastModel': '', 'sourceCommitSha': '', 'lastKnowledgeSize': 0},
            'createdAt': iso(-60)
        }
    ]

    tasks = [
        {
            'id': 'tsk-001', 'title': 'SSO Login Flow implementieren', 'description': 'OIDC Redirect, Session Refresh und Fehlerfaelle behandeln.',
            'priority': 'high', 'status': 'in-progress', 'projectId': 'prj-aurora', 'assigneeId': 'emp-sara', 'labels': ['lbl-feature', 'lbl-security'],
            'urgency': 'high', 'effortHours': 16, 'effortPoints': 8,
            'schedule': {'mode': 'deadline', 'deadline': iso(5)[:10], 'fixedAt': '', 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [
                {'id': 'st-001-1', 'title': 'Token Handling', 'completed': True, 'createdAt': iso(-6)},
                {'id': 'st-001-2', 'title': 'Silent Refresh', 'completed': False, 'createdAt': iso(-5)}
            ],
            'notes': [{'id': 'nt-001-1', 'text': 'Keycloak Testrealm verwendet.', 'createdAt': iso(-4)}],
            'attachments': [{'id': 'at-001-1', 'name': 'OIDC Spec', 'url': 'https://openid.net/specs/openid-connect-core-1_0.html', 'type': 'link', 'size': 0, 'addedAt': iso(-4)}],
            'createdAt': iso(-8), 'updatedAt': iso(-1), 'startDate': iso(-7)[:10], 'endDate': iso(5)[:10], 'dueDate': iso(5)[:10]
        },
        {
            'id': 'tsk-002', 'title': 'Kundenprofil UI refactoren', 'description': 'Formularlayout und Validation vereinheitlichen.',
            'priority': 'medium', 'status': 'review', 'projectId': 'prj-aurora', 'assigneeId': 'emp-tim', 'labels': ['lbl-feature'],
            'urgency': 'normal', 'effortHours': 10, 'effortPoints': 5,
            'schedule': {'mode': 'fixed', 'deadline': '', 'fixedAt': iso(2)[:10], 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-12), 'updatedAt': iso(-1), 'startDate': iso(-10)[:10], 'endDate': iso(2)[:10], 'dueDate': iso(2)[:10]
        },
        {
            'id': 'tsk-003', 'title': 'API Rate-Limit Middleware', 'description': 'Tenant-basierte Limits mit Burst support.',
            'priority': 'blocker', 'status': 'todo', 'projectId': 'prj-mercury', 'assigneeId': 'emp-jan', 'labels': ['lbl-ops', 'lbl-security'],
            'urgency': 'critical', 'effortHours': 14, 'effortPoints': 9,
            'schedule': {'mode': 'range', 'deadline': '', 'fixedAt': '', 'rangeStart': iso(1)[:10], 'rangeEnd': iso(12)[:10]},
            'subtasks': [], 'notes': [{'id': 'nt-003-1', 'text': 'Abgleich mit Security Team noetig.', 'createdAt': iso(-2)}], 'attachments': [],
            'createdAt': iso(-9), 'updatedAt': iso(-1), 'startDate': iso(1)[:10], 'endDate': iso(12)[:10], 'dueDate': iso(12)[:10]
        },
        {
            'id': 'tsk-004', 'title': 'Webhook Signaturpruefung fixen', 'description': 'Timing-safe compare einbauen.',
            'priority': 'high', 'status': 'done', 'projectId': 'prj-mercury', 'assigneeId': 'emp-sara', 'labels': ['lbl-bug', 'lbl-security'],
            'urgency': 'high', 'effortHours': 6, 'effortPoints': 3,
            'schedule': {'mode': 'none', 'deadline': '', 'fixedAt': '', 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-20), 'updatedAt': iso(-7), 'startDate': iso(-19)[:10], 'endDate': iso(-7)[:10], 'dueDate': iso(-7)[:10]
        },
        {
            'id': 'tsk-005', 'title': 'Runbook fuer Incident Response', 'description': 'On-call Ablauf und Eskalation dokumentieren.',
            'priority': 'medium', 'status': 'backlog', 'projectId': 'prj-orbit', 'assigneeId': None, 'labels': ['lbl-docs', 'lbl-ops'],
            'urgency': 'low', 'effortHours': 8, 'effortPoints': 3,
            'schedule': {'mode': 'asap', 'deadline': '', 'fixedAt': '', 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-3), 'updatedAt': iso(-1), 'startDate': iso(-3)[:10], 'endDate': iso(7)[:10], 'dueDate': iso(7)[:10]
        },
        {
            'id': 'tsk-006', 'title': 'Monitoring Alerts kalibrieren', 'description': 'False positives reduzieren.',
            'priority': 'low', 'status': 'todo', 'projectId': 'prj-orbit', 'assigneeId': 'emp-nina', 'labels': ['lbl-ops'],
            'urgency': 'normal', 'effortHours': 5, 'effortPoints': 2,
            'schedule': {'mode': 'deadline', 'deadline': iso(14)[:10], 'fixedAt': '', 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-2), 'updatedAt': iso(-1), 'startDate': iso(-1)[:10], 'endDate': iso(14)[:10], 'dueDate': iso(14)[:10]
        },
        {
            'id': 'tsk-007', 'title': 'Deploy Runner Netzwerkfreigabe', 'description': 'Firewall-Regeln fuer Runner subnet anpassen.',
            'priority': 'blocker', 'status': 'in-progress', 'projectId': 'prj-vulcan', 'assigneeId': 'emp-jan', 'labels': ['lbl-ops'],
            'urgency': 'critical', 'effortHours': 12, 'effortPoints': 8,
            'schedule': {'mode': 'deadline', 'deadline': iso(3)[:10], 'fixedAt': '', 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-6), 'updatedAt': iso(-1), 'startDate': iso(-5)[:10], 'endDate': iso(3)[:10], 'dueDate': iso(3)[:10]
        },
        {
            'id': 'tsk-008', 'title': 'Blue-Green Rollout Doku', 'description': 'Release Schrittfolge dokumentieren.',
            'priority': 'medium', 'status': 'done', 'projectId': 'prj-vulcan', 'assigneeId': 'emp-lea', 'labels': ['lbl-docs'],
            'urgency': 'low', 'effortHours': 4, 'effortPoints': 2,
            'schedule': {'mode': 'none', 'deadline': '', 'fixedAt': '', 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-14), 'updatedAt': iso(-9), 'startDate': iso(-14)[:10], 'endDate': iso(-9)[:10], 'dueDate': iso(-9)[:10]
        },
        {
            'id': 'tsk-009', 'title': 'Suchindex Dokumentation aktualisieren', 'description': 'Neue API-Endpunkte in Docs aufnehmen.',
            'priority': 'low', 'status': 'review', 'projectId': 'prj-atlas', 'assigneeId': 'emp-omer', 'labels': ['lbl-docs'],
            'urgency': 'normal', 'effortHours': 3, 'effortPoints': 1,
            'schedule': {'mode': 'fixed', 'deadline': '', 'fixedAt': iso(1)[:10], 'rangeStart': '', 'rangeEnd': ''},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-4), 'updatedAt': iso(-1), 'startDate': iso(-4)[:10], 'endDate': iso(1)[:10], 'dueDate': iso(1)[:10]
        },
        {
            'id': 'tsk-010', 'title': 'Regressionstest Login', 'description': 'Smoke-Test fuer Hauptpfade.',
            'priority': 'high', 'status': 'todo', 'projectId': 'prj-aurora', 'assigneeId': 'emp-nina', 'labels': ['lbl-bug'],
            'urgency': 'high', 'effortHours': 7, 'effortPoints': 4,
            'schedule': {'mode': 'range', 'deadline': '', 'fixedAt': '', 'rangeStart': iso(0)[:10], 'rangeEnd': iso(6)[:10]},
            'subtasks': [], 'notes': [], 'attachments': [],
            'createdAt': iso(-1), 'updatedAt': iso(-1), 'startDate': iso(0)[:10], 'endDate': iso(6)[:10], 'dueDate': iso(6)[:10]
        }
    ]

    templates = [
        {'id': 'tpl-bugfix', 'title': 'Bugfix Ticket', 'description': 'Titel, Reproduktion, Erwartung, Risiko, Test.', 'createdAt': iso(-30)},
        {'id': 'tpl-feature', 'title': 'Feature Task', 'description': 'Use Case, Scope, ACs, Telemetrie, Rollout.', 'createdAt': iso(-20)},
        {'id': 'tpl-release', 'title': 'Release Checklist', 'description': 'Build, QA, Security-Check, Freigabe.', 'createdAt': iso(-14)}
    ]

    releases = [
        {'id': 'rel-aurora-110', 'projectId': 'prj-aurora', 'title': 'Aurora v1.1.0', 'version': '1.1.0', 'description': 'SSO und Profil-Verbesserungen', 'status': 'RC', 'date': iso(-1), 'createdAt': iso(-5), 'changelog': [{'id': 'ch-1', 'taskTitle': 'Webhook Signaturpruefung fixen', 'taskId': 'tsk-004', 'category': 'Bugfix', 'description': 'Security hardening', 'completedAt': iso(-7)}], 'tasks': ['tsk-004']},
        {'id': 'rel-mercury-200', 'projectId': 'prj-mercury', 'title': 'Mercury v2.0.0', 'version': '2.0.0', 'description': 'Gateway foundations', 'status': 'Draft', 'date': iso(-2), 'createdAt': iso(-2), 'changelog': [], 'tasks': []},
        {'id': 'rel-atlas-100', 'projectId': 'prj-atlas', 'title': 'Atlas v1.0.0', 'version': '1.0.0', 'description': 'Initial docs set', 'status': 'Released', 'date': iso(-10), 'createdAt': iso(-12), 'changelog': [{'id': 'ch-2', 'taskTitle': 'Blue-Green Rollout Doku', 'taskId': 'tsk-008', 'category': 'Dokumentation', 'description': '', 'completedAt': iso(-9)}], 'tasks': ['tsk-008']}
    ]

    notifications = [
        {'id': 'not-001', 'message': '@team Sprint Planning startet morgen 09:30.', 'type': 'info', 'read': False, 'createdAt': iso(-1)},
        {'id': 'not-002', 'message': 'Build Pipeline fuer Vulcan ist blockiert.', 'type': 'warning', 'read': False, 'createdAt': iso(-1)},
        {'id': 'not-003', 'message': 'Webhook Signaturfix wurde erfolgreich ausgerollt.', 'type': 'success', 'read': True, 'createdAt': iso(-7)}
    ]

    calendar_events = [
        {'id': 'evt-standup', 'title': 'Daily Standup', 'date': iso(1)[:10], 'startDate': iso(1)[:10], 'projectId': 'prj-aurora', 'type': 'meeting', 'createdAt': iso(-5), 'updatedAt': iso(-1)},
        {'id': 'evt-retro', 'title': 'Sprint Retro', 'date': iso(6)[:10], 'startDate': iso(6)[:10], 'projectId': 'prj-mercury', 'type': 'meeting', 'createdAt': iso(-5), 'updatedAt': iso(-1)},
        {'id': 'evt-release', 'title': 'Release Go/No-Go', 'date': iso(3)[:10], 'startDate': iso(3)[:10], 'projectId': 'prj-aurora', 'type': 'milestone', 'createdAt': iso(-5), 'updatedAt': iso(-1)}
    ]

    sprint_data = {
        'sprints': [
            {
                'id': 'sp-alpha',
                'name': 'Sprint Alpha',
                'startDate': iso(-5)[:10],
                'endDate': iso(9)[:10],
                'goal': 'SSO ready for acceptance test',
                'status': 'active',
                'tasks': ['tsk-001', 'tsk-002', 'tsk-003', 'tsk-010'],
                'createdAt': iso(-5),
                'completedAt': None
            },
            {
                'id': 'sp-docs',
                'name': 'Sprint Docs',
                'startDate': iso(-25)[:10],
                'endDate': iso(-12)[:10],
                'goal': 'Runbook und Release-Doku',
                'status': 'completed',
                'tasks': ['tsk-008', 'tsk-009'],
                'createdAt': iso(-25),
                'completedAt': iso(-12)
            }
        ],
        'retros': {
            'sp-docs': {
                'notes': 'Was lief gut: klare Verantwortlichkeiten. Verbesserung: fruehere QA-Einbindung.',
                'updatedAt': iso(-11)
            }
        }
    }

    payload = {
        'version': '1.0',
        'exportedAt': iso(0),
        'projects': projects,
        'tasks': tasks,
        'employees': employees,
        'labels': labels,
        'templates': templates,
        'releases': releases,
        'notifications': notifications,
        'calendarEvents': calendar_events
    }

    kv_map = {
        'pd_projects': json.dumps(projects, ensure_ascii=False),
        'pd_tasks': json.dumps(tasks, ensure_ascii=False),
        'pd_employees': json.dumps(employees, ensure_ascii=False),
        'pd_labels': json.dumps(labels, ensure_ascii=False),
        'pd_templates': json.dumps(templates, ensure_ascii=False),
        'pd_releases': json.dumps(releases, ensure_ascii=False),
        'pd_notifications': json.dumps(notifications, ensure_ascii=False),
        'pd_calendar_events': json.dumps(calendar_events, ensure_ascii=False),
        'pd_theme': 'dark',
        'pd_sprint_sprints': json.dumps(sprint_data['sprints'], ensure_ascii=False),
        'pd_sprint_retros': json.dumps(sprint_data['retros'], ensure_ascii=False)
    }

    return payload, kv_map


def ensure_schema(connection):
    connection.execute(
        'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL)'
    )
    connection.commit()


def verify_roundtrip(connection):
    key = '__seed_selftest__'
    value = 'ok-' + iso(0)
    updated_at = iso(0)
    connection.execute(
        'INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)',
        (key, value, updated_at)
    )
    row = connection.execute('SELECT value FROM kv_store WHERE key = ?', (key,)).fetchone()
    if not row or row[0] != value:
        raise RuntimeError('Roundtrip-Test fehlgeschlagen: gespeicherter Wert ist inkonsistent.')
    connection.execute('DELETE FROM kv_store WHERE key = ?', (key,))
    connection.commit()


def write_seed(connection, kv_map):
    now = iso(0)
    for key, value in kv_map.items():
        connection.execute(
            'INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)',
            (key, value, now)
        )
    connection.commit()


def main():
    payload, kv_map = build_seed_payload()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        ensure_schema(conn)
        verify_roundtrip(conn)
        write_seed(conn, kv_map)

        count = conn.execute('SELECT COUNT(*) FROM kv_store').fetchone()[0]
        keys = [row[0] for row in conn.execute('SELECT key FROM kv_store ORDER BY key').fetchall()]

    JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

    print('Seed abgeschlossen.')
    print('SQLite:', DB_PATH)
    print('JSON  :', JSON_PATH)
    print('Eintraege kv_store:', count)
    print('Keys:', ', '.join(keys))
    print('Datensaetze: projects={0}, tasks={1}, employees={2}, labels={3}, templates={4}, releases={5}, notifications={6}, calendarEvents={7}'.format(
        len(payload['projects']),
        len(payload['tasks']),
        len(payload['employees']),
        len(payload['labels']),
        len(payload['templates']),
        len(payload['releases']),
        len(payload['notifications']),
        len(payload['calendarEvents'])
    ))


if __name__ == '__main__':
    main()
