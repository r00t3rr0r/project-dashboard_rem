import json
import os
import re
import sqlite3
import shutil
import uuid
import urllib.error
import subprocess
import time
import urllib.request
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.sqlite')
BACKUP_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.backup.sqlite')
BACKUP_JSON_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.backup.json')
BACKUP_STAMP_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.backup.stamp')
KNOWLEDGE_DIR = os.path.join(ROOT, 'data', 'project-knowledge')
MEETINGS_DIR = os.path.join(ROOT, 'data', 'meetings')
HOST = '127.0.0.1'
PORT = int(os.environ.get('PROJECT_DASHBOARD_STORAGE_PORT', '8766'))
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M')
OLLAMA_AUTOSTART = str(os.environ.get('PROJECT_DASHBOARD_OLLAMA_AUTOSTART', '1')).strip().lower() not in ('0', 'false', 'no')
GITHUB_API_BASE = 'https://api.github.com'
BOOTSTRAP_STATUS = {
    'dbRestore': {'restored': False, 'source': 'unknown', 'rows': 0},
    'ollama': {'status': 'unknown', 'autostart': OLLAMA_AUTOSTART, 'detail': ''}
}


def utc_now_iso_z():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _read_kv_rows(path):
    if not os.path.exists(path):
        return []
    try:
        conn = sqlite3.connect(path)
        try:
            rows = conn.execute('SELECT key, value, updatedAt FROM kv_store ORDER BY key').fetchall()
            return rows
        finally:
            conn.close()
    except Exception:
        return []


def _read_kv_json(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            payload = json.load(handle)
    except Exception:
        return {}

    data = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return {}

    out = {}
    for key, value in data.items():
        if value is None:
            continue
        out[str(key)] = str(value)
    return out


def restore_db_if_empty():
    conn = sqlite3.connect(DB_PATH)
    try:
        existing_count = conn.execute('SELECT COUNT(*) FROM kv_store').fetchone()[0]
        if existing_count > 0:
            return {'restored': False, 'source': 'db', 'rows': existing_count}

        rows = _read_kv_rows(BACKUP_PATH)
        if rows:
            conn.executemany(
                'INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)',
                [(str(k), str(v), str(ts or utc_now_iso_z())) for k, v, ts in rows if k is not None and v is not None]
            )
            conn.commit()
            return {'restored': True, 'source': 'backup-sqlite', 'rows': len(rows)}

        kv_payload = _read_kv_json(BACKUP_JSON_PATH)
        if kv_payload:
            now = utc_now_iso_z()
            conn.executemany(
                'INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)',
                [(key, value, now) for key, value in kv_payload.items()]
            )
            conn.commit()
            return {'restored': True, 'source': 'backup-json', 'rows': len(kv_payload)}

        return {'restored': False, 'source': 'none', 'rows': 0}
    finally:
        conn.close()


def _is_ollama_ready():
    endpoint = OLLAMA_BASE_URL + '/api/tags'
    request = urllib.request.Request(endpoint, method='GET')
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            if response.status < 200 or response.status >= 300:
                return False
        return True
    except Exception:
        return False


def ensure_ollama_runtime():
    if _is_ollama_ready():
        return {'status': 'ok', 'autostart': OLLAMA_AUTOSTART, 'detail': 'already-running'}

    if not OLLAMA_AUTOSTART:
        return {'status': 'missing', 'autostart': False, 'detail': 'autostart-disabled'}
    if not shutil.which('ollama'):
        return {'status': 'missing', 'autostart': True, 'detail': 'ollama-binary-not-found'}

    try:
        subprocess.Popen(
            ['ollama', 'serve'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
    except Exception as exc:
        return {'status': 'error', 'autostart': True, 'detail': 'start-failed: ' + str(exc)}

    # Short readiness window so startup remains fast.
    for _ in range(10):
        if _is_ollama_ready():
            return {'status': 'ok', 'autostart': True, 'detail': 'started-by-server'}
        time.sleep(0.3)

    return {'status': 'error', 'autostart': True, 'detail': 'started-but-not-ready'}


def ensure_daily_backup(force=False):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if not os.path.exists(DB_PATH):
        return False

    today = date.today().isoformat()
    last_backup_day = ''
    if os.path.exists(BACKUP_STAMP_PATH):
        try:
            with open(BACKUP_STAMP_PATH, 'r', encoding='utf-8') as handle:
                last_backup_day = handle.read().strip()
        except Exception:
            last_backup_day = ''

    if not force and last_backup_day == today and os.path.exists(BACKUP_PATH) and os.path.exists(BACKUP_JSON_PATH):
        return False

    source_conn = sqlite3.connect(DB_PATH)
    backup_conn = sqlite3.connect(BACKUP_PATH)
    try:
        source_conn.backup(backup_conn)
    finally:
        backup_conn.close()
        source_conn.close()

    snapshot_conn = sqlite3.connect(DB_PATH)
    try:
        rows = snapshot_conn.execute('SELECT key, value FROM kv_store ORDER BY key').fetchall()
        payload = {
            'exportedAt': utc_now_iso_z(),
            'data': {key: value for key, value in rows}
        }
        with open(BACKUP_JSON_PATH, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
    finally:
        snapshot_conn.close()

    with open(BACKUP_STAMP_PATH, 'w', encoding='utf-8') as handle:
        handle.write(today)
    return True


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
    os.makedirs(MEETINGS_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL)')
    conn.commit()
    conn.close()
    restore_result = restore_db_if_empty()
    BOOTSTRAP_STATUS['dbRestore'] = restore_result
    if restore_result.get('restored'):
        print('[Bootstrap] Restored KV store from {source} ({rows} rows).'.format(
            source=restore_result.get('source', 'unknown'),
            rows=restore_result.get('rows', 0)
        ))
    BOOTSTRAP_STATUS['ollama'] = ensure_ollama_runtime()
    if BOOTSTRAP_STATUS['ollama'].get('status') != 'ok':
        print('[Bootstrap] Ollama status: {status} ({detail})'.format(
            status=BOOTSTRAP_STATUS['ollama'].get('status', 'unknown'),
            detail=BOOTSTRAP_STATUS['ollama'].get('detail', '')
        ))
    ensure_daily_backup(force=True)


init_db()


class StorageHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        ensure_daily_backup()
        parsed = urlparse(self.path)
        meeting_project_id = self._extract_meeting_project_id(parsed.path)
        if meeting_project_id:
            self._handle_meetings_get(meeting_project_id)
            return
        if parsed.path == '/api/kv':
            self._send_json(self._read_all())
            return
        if parsed.path == '/api/github/repo':
            self._handle_github_repo_get(parsed)
            return
        if parsed.path == '/api/github/commits':
            self._handle_github_commits_get(parsed)
            return
        if parsed.path == '/api/ai/health':
            self._send_json(self._check_ai_health())
            return
        if parsed.path == '/api/health':
            self._send_json({
                'status': 'ok',
                'db': DB_PATH,
                'knowledgeDir': KNOWLEDGE_DIR,
                'bootstrap': BOOTSTRAP_STATUS
            })
            return
        self._serve_static(parsed.path)

    def do_POST(self):
        ensure_daily_backup()
        parsed = urlparse(self.path)
        meeting_project_id = self._extract_meeting_project_id(parsed.path)
        if meeting_project_id:
            self._handle_meetings_post(meeting_project_id)
            return
        if parsed.path == '/api/kv':
            self._handle_kv_post()
            return
        if parsed.path == '/api/ai/project-knowledge':
            self._handle_project_knowledge_post()
            return
        if parsed.path == '/api/ai/meeting-to-concept':
            self._handle_meeting_to_concept_post()
            return
        if parsed.path == '/api/ai/concept-to-plan':
            self._handle_concept_to_plan_post()
            return
        if parsed.path == '/api/ai/plan-to-tasks':
            self._handle_plan_to_tasks_post()
            return
        if parsed.path == '/api/ai/meeting-task-draft':
            self._handle_meeting_task_draft_post()
            return
        if parsed.path == '/api/ai/project-milestones-draft':
            self._handle_project_milestones_draft_post()
            return
        self.send_response(404)
        self.end_headers()

    def _handle_kv_post(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        try:
            payload = json.loads(body or '{}')
        except Exception as exc:
            self._send_json({'error': str(exc)}, status=400)
            return

        if payload.get('clear') is True:
            self._clear_all_values()
            self._send_json({'ok': True, 'cleared': True})
            return

        key = payload.get('key')
        value = payload.get('value')
        if not key:
            self._send_json({'error': 'Missing key'}, status=400)
            return

        self._write_value(key, value)
        self._send_json({'ok': True, 'key': key})

    def _handle_project_knowledge_post(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        try:
            payload = json.loads(body or '{}')
        except Exception as exc:
            self._send_json({'error': str(exc)}, status=400)
            return

        project_id = str(payload.get('projectId') or '').strip()
        project_title = str(payload.get('projectTitle') or '').strip()
        if not project_id or not project_title:
            self._send_json({'error': 'projectId and projectTitle are required.'}, status=400)
            return

        github = payload.get('github') if isinstance(payload.get('github'), dict) else {}
        snapshot = payload.get('snapshot') if isinstance(payload.get('snapshot'), dict) else {}
        model = str(payload.get('model') or OLLAMA_DEFAULT_MODEL).strip() or OLLAMA_DEFAULT_MODEL

        prompt = self._build_project_prompt(project_title, github, snapshot)
        try:
            ai_text, _ai_chunks = self._call_ollama(model, prompt)
        except RuntimeError as exc:
            self._send_json({'error': str(exc)}, status=502)
            return

        generated_at = utc_now_iso_z()
        file_name = self._safe_file_name(project_id + '-' + project_title) + '-ki-wissen.md'
        relative_path = os.path.join('data', 'project-knowledge', file_name).replace('\\', '/')
        full_path = os.path.join(ROOT, relative_path)

        document = self._build_knowledge_document(
            project_id=project_id,
            project_title=project_title,
            github=github,
            generated_at=generated_at,
            model=model,
            ai_text=ai_text
        )

        with open(full_path, 'w', encoding='utf-8') as handle:
            handle.write(document)

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'model': model,
            'generatedAt': generated_at,
            'filePath': '/' + relative_path,
            'bytes': len(document.encode('utf-8'))
        })

    def _extract_meeting_project_id(self, path):
        match = re.match(r'^/api/meetings/([^/]+)$', path or '')
        if not match:
            return ''
        return str(match.group(1) or '').strip()

    def _meeting_file_path(self, project_id):
        safe_project = self._safe_file_name(project_id)
        return os.path.join(MEETINGS_DIR, safe_project + '.json')

    def _handle_meetings_get(self, project_id):
        full_path = self._meeting_file_path(project_id)
        notes = []
        updated_at = ''

        if os.path.exists(full_path):
            try:
                with open(full_path, 'r', encoding='utf-8') as handle:
                    payload = json.load(handle)
                if isinstance(payload, dict):
                    updated_at = str(payload.get('updatedAt') or '')
                    candidate_notes = payload.get('notes')
                    if isinstance(candidate_notes, list):
                        notes = [item for item in candidate_notes if isinstance(item, dict)]
            except Exception:
                notes = []
                updated_at = ''

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'updatedAt': updated_at,
            'notes': notes
        })

    def _handle_meetings_post(self, project_id):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        try:
            payload = json.loads(body or '{}')
        except Exception as exc:
            self._send_json({'error': str(exc)}, status=400)
            return

        notes = payload.get('notes') if isinstance(payload, dict) else []
        if not isinstance(notes, list):
            self._send_json({'error': 'notes must be an array.'}, status=400)
            return

        sanitized = []
        now_iso = utc_now_iso_z()
        for item in notes:
            if not isinstance(item, dict):
                continue
            text = str(item.get('text') or '').strip()
            if not text:
                continue
            sanitized.append({
                'id': str(item.get('id') or uuid.uuid4().hex),
                'text': text,
                'label': str(item.get('label') or '').strip(),
                'createdAt': str(item.get('createdAt') or now_iso)
            })

        record = {
            'projectId': project_id,
            'updatedAt': now_iso,
            'notes': sanitized
        }

        with open(self._meeting_file_path(project_id), 'w', encoding='utf-8') as handle:
            json.dump(record, handle, ensure_ascii=False, indent=2)
            handle.write('\n')

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'updatedAt': now_iso,
            'count': len(sanitized)
        })

    def _handle_meeting_to_concept_post(self):
        payload, error = self._read_json_payload()
        if error:
            self._send_json({'error': error}, status=400)
            return

        project_id, project_title, validation_error = self._read_project_identity(payload)
        if validation_error:
            self._send_json({'error': validation_error}, status=400)
            return

        prompt_config = payload.get('promptConfig') if isinstance(payload.get('promptConfig'), dict) else {}
        model = str(prompt_config.get('model') or payload.get('model') or OLLAMA_DEFAULT_MODEL).strip() or OLLAMA_DEFAULT_MODEL
        temperature = self._read_temperature(prompt_config)
        max_tokens = self._read_max_tokens(prompt_config)
        output_format = str(prompt_config.get('outputFormat') or 'Markdown').strip() or 'Markdown'
        language = str(prompt_config.get('language') or 'DE').strip() or 'DE'

        note_markdown = self._meeting_notes_markdown(payload)
        existing_data = payload.get('existingData') if isinstance(payload.get('existingData'), dict) else {}

        generated_prompt = str(prompt_config.get('prompt') or '').strip()
        if not generated_prompt:
            generated_prompt = self._build_meeting_concept_prompt(
                project_title=project_title,
                meeting_notes_markdown=note_markdown,
                existing_data=existing_data,
                output_format=output_format,
                language=language,
                preset=str(prompt_config.get('presetName') or prompt_config.get('presetKey') or 'Kreativ & Visionaer').strip()
            )

        try:
            concept_markdown, concept_chunks = self._call_ollama(model, generated_prompt, temperature=temperature, max_tokens=max_tokens)
        except RuntimeError as exc:
            self._send_json({'error': str(exc)}, status=502)
            return

        stage_result = self._persist_pipeline_result(
            project_id=project_id,
            project_title=project_title,
            stage='concept',
            model=model,
            prompt=generated_prompt,
            content=concept_markdown
        )

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'stage': 'concept',
            'model': model,
            'temperature': temperature,
            'maxTokens': max_tokens,
            'generatedAt': stage_result.get('generatedAt'),
            'filePath': stage_result.get('filePath'),
            'markdown': concept_markdown,
            'markdownChunks': concept_chunks,
            'chunkCount': len(concept_chunks),
            'bytes': stage_result.get('bytes')
        })

    def _handle_concept_to_plan_post(self):
        payload, error = self._read_json_payload()
        if error:
            self._send_json({'error': error}, status=400)
            return

        project_id, project_title, validation_error = self._read_project_identity(payload)
        if validation_error:
            self._send_json({'error': validation_error}, status=400)
            return

        prompt_config = payload.get('promptConfig') if isinstance(payload.get('promptConfig'), dict) else {}
        model = str(prompt_config.get('model') or payload.get('model') or OLLAMA_DEFAULT_MODEL).strip() or OLLAMA_DEFAULT_MODEL
        temperature = self._read_temperature(prompt_config)
        max_tokens = self._read_max_tokens(prompt_config)
        output_format = str(prompt_config.get('outputFormat') or 'Markdown').strip() or 'Markdown'
        language = str(prompt_config.get('language') or 'DE').strip() or 'DE'

        note_markdown = self._meeting_notes_markdown(payload)
        concept_markdown = str(payload.get('conceptMarkdown') or '').strip()
        existing_data = payload.get('existingData') if isinstance(payload.get('existingData'), dict) else {}

        generated_prompt = str(prompt_config.get('prompt') or '').strip()
        if not generated_prompt:
            generated_prompt = self._build_concept_to_plan_prompt(
                project_title=project_title,
                concept_markdown=concept_markdown,
                meeting_notes_markdown=note_markdown,
                existing_data=existing_data,
                output_format=output_format,
                language=language,
                preset=str(prompt_config.get('presetName') or prompt_config.get('presetKey') or 'Projektmanager').strip()
            )

        try:
            plan_markdown, plan_chunks = self._call_ollama(model, generated_prompt, temperature=temperature, max_tokens=max_tokens)
        except RuntimeError as exc:
            self._send_json({'error': str(exc)}, status=502)
            return

        stage_result = self._persist_pipeline_result(
            project_id=project_id,
            project_title=project_title,
            stage='plan',
            model=model,
            prompt=generated_prompt,
            content=plan_markdown
        )

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'stage': 'plan',
            'model': model,
            'temperature': temperature,
            'maxTokens': max_tokens,
            'generatedAt': stage_result.get('generatedAt'),
            'filePath': stage_result.get('filePath'),
            'markdown': plan_markdown,
            'markdownChunks': plan_chunks,
            'chunkCount': len(plan_chunks),
            'bytes': stage_result.get('bytes')
        })

    def _handle_plan_to_tasks_post(self):
        payload, error = self._read_json_payload()
        if error:
            self._send_json({'error': error}, status=400)
            return

        project_id, project_title, validation_error = self._read_project_identity(payload)
        if validation_error:
            self._send_json({'error': validation_error}, status=400)
            return

        prompt_config = payload.get('promptConfig') if isinstance(payload.get('promptConfig'), dict) else {}
        model = str(prompt_config.get('model') or payload.get('model') or OLLAMA_DEFAULT_MODEL).strip() or OLLAMA_DEFAULT_MODEL
        temperature = self._read_temperature(prompt_config)
        max_tokens = self._read_max_tokens(prompt_config)
        language = str(prompt_config.get('language') or 'DE').strip() or 'DE'

        note_markdown = self._meeting_notes_markdown(payload)
        concept_markdown = str(payload.get('conceptMarkdown') or '').strip()
        plan_markdown = str(payload.get('planMarkdown') or '').strip()
        existing_data = payload.get('existingData') if isinstance(payload.get('existingData'), dict) else {}

        generated_prompt = str(prompt_config.get('prompt') or '').strip()
        if not generated_prompt:
            generated_prompt = self._build_plan_to_tasks_prompt(
                project_title=project_title,
                concept_markdown=concept_markdown,
                plan_markdown=plan_markdown,
                meeting_notes_markdown=note_markdown,
                existing_data=existing_data,
                language=language,
                preset=str(prompt_config.get('presetName') or prompt_config.get('presetKey') or 'Praezise & Technisch').strip()
            )

        try:
            tasks_response, tasks_chunks = self._call_ollama(model, generated_prompt, temperature=temperature, max_tokens=max_tokens, response_format='json')
        except RuntimeError as exc:
            self._send_json({'error': str(exc)}, status=502)
            return

        parsed = self._extract_task_payload(tasks_response)
        stage_result = self._persist_pipeline_result(
            project_id=project_id,
            project_title=project_title,
            stage='tasks',
            model=model,
            prompt=generated_prompt,
            content=parsed.get('markdown') or tasks_response
        )

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'stage': 'tasks',
            'model': model,
            'temperature': temperature,
            'maxTokens': max_tokens,
            'generatedAt': stage_result.get('generatedAt'),
            'filePath': stage_result.get('filePath'),
            'markdown': parsed.get('markdown') or tasks_response,
            'markdownChunks': tasks_chunks,
            'chunkCount': len(tasks_chunks),
            'tasks': parsed.get('tasks', []),
            'bytes': stage_result.get('bytes')
        })

    def _handle_meeting_task_draft_post(self):
        payload, error = self._read_json_payload()
        if error:
            self._send_json({'error': error}, status=400)
            return

        project_id, project_title, validation_error = self._read_project_identity(payload)
        if validation_error:
            self._send_json({'error': validation_error}, status=400)
            return

        prompt_config = payload.get('promptConfig') if isinstance(payload.get('promptConfig'), dict) else {}
        options = payload.get('options') if isinstance(payload.get('options'), dict) else {}

        model = str(prompt_config.get('model') or payload.get('model') or OLLAMA_DEFAULT_MODEL).strip() or OLLAMA_DEFAULT_MODEL
        temperature = self._read_temperature(prompt_config)
        max_tokens = self._read_max_tokens(prompt_config)

        user_input = str(payload.get('draftInput') or '').strip()
        if not user_input:
            self._send_json({'error': 'draftInput is required.'}, status=400)
            return

        note_markdown = self._meeting_notes_markdown(payload)
        existing_data = payload.get('existingData') if isinstance(payload.get('existingData'), dict) else {}
        generated_prompt = str(prompt_config.get('prompt') or '').strip()
        if not generated_prompt:
            generated_prompt = self._build_meeting_task_draft_prompt(
                project_title=project_title,
                meeting_notes_markdown=note_markdown,
                user_input=user_input,
                options=options,
                existing_data=existing_data
            )

        try:
            raw_response, response_chunks = self._call_ollama(model, generated_prompt, temperature=temperature, max_tokens=max_tokens, response_format='json')
        except RuntimeError as exc:
            self._send_json({'error': str(exc)}, status=502)
            return

        parsed = self._extract_meeting_task_draft_payload(raw_response, options)
        stage_result = self._persist_pipeline_result(
            project_id=project_id,
            project_title=project_title,
            stage='task-draft',
            model=model,
            prompt=generated_prompt,
            content=parsed.get('summaryMarkdown') or raw_response
        )

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'stage': 'task-draft',
            'model': model,
            'temperature': temperature,
            'maxTokens': max_tokens,
            'generatedAt': stage_result.get('generatedAt'),
            'filePath': stage_result.get('filePath'),
            'markdown': parsed.get('summaryMarkdown') or raw_response,
            'markdownChunks': response_chunks,
            'chunkCount': len(response_chunks),
            'draft': parsed,
            'bytes': stage_result.get('bytes')
        })

    def _handle_project_milestones_draft_post(self):
        payload, error = self._read_json_payload()
        if error:
            self._send_json({'error': error}, status=400)
            return

        project_id = str(payload.get('projectId') or '').strip()
        project_title = str(payload.get('projectTitle') or '').strip()
        if not project_id or not project_title:
            self._send_json({'error': 'projectId and projectTitle are required.'}, status=400)
            return

        project_description = str(payload.get('projectDescription') or '').strip()
        project_status = str(payload.get('projectStatus') or '').strip()
        meeting = payload.get('meeting') if isinstance(payload.get('meeting'), dict) else {}
        queued = payload.get('queued') if isinstance(payload.get('queued'), dict) else {}

        model = str(payload.get('model') or OLLAMA_DEFAULT_MODEL).strip() or OLLAMA_DEFAULT_MODEL
        prompt = self._build_project_milestones_prompt(
            project_title=project_title,
            project_description=project_description,
            project_status=project_status,
            meeting=meeting,
            queued=queued
        )

        try:
            raw_response, response_chunks = self._call_ollama(model, prompt, temperature=0.2, max_tokens=1800, response_format='json')
        except RuntimeError as exc:
            self._send_json({'error': str(exc)}, status=502)
            return

        parsed = self._extract_project_milestones_payload(raw_response)
        stage_result = self._persist_pipeline_result(
            project_id=project_id,
            project_title=project_title,
            stage='milestones-draft',
            model=model,
            prompt=prompt,
            content=parsed.get('summaryMarkdown') or raw_response
        )

        self._send_json({
            'ok': True,
            'projectId': project_id,
            'stage': 'milestones-draft',
            'model': model,
            'generatedAt': stage_result.get('generatedAt'),
            'filePath': stage_result.get('filePath'),
            'markdown': parsed.get('summaryMarkdown') or raw_response,
            'markdownChunks': response_chunks,
            'chunkCount': len(response_chunks),
            'draft': parsed,
            'bytes': stage_result.get('bytes')
        })

    def _read_json_payload(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        try:
            payload = json.loads(body or '{}')
        except Exception as exc:
            return None, str(exc)
        if not isinstance(payload, dict):
            return None, 'Payload must be a JSON object.'
        return payload, ''

    def _read_project_identity(self, payload):
        project_id = str(payload.get('projectId') or '').strip()
        project_title = str(payload.get('projectTitle') or '').strip()
        if not project_id or not project_title:
            return '', '', 'projectId and projectTitle are required.'
        return project_id, project_title, ''

    def _read_temperature(self, prompt_config):
        default = 0.3
        raw = prompt_config.get('temperature')
        try:
            parsed = float(raw)
        except Exception:
            return default
        return max(0.0, min(1.0, parsed))

    def _read_max_tokens(self, prompt_config):
        default = 1500
        raw = prompt_config.get('maxTokens')
        try:
            parsed = int(raw)
        except Exception:
            return default
        return max(200, min(6000, parsed))

    def _meeting_notes_markdown(self, payload):
        markdown = str(payload.get('meetingNotesMarkdown') or '').strip()
        if markdown:
            return markdown

        notes = payload.get('meetingNotes') if isinstance(payload.get('meetingNotes'), list) else []
        lines = []
        for item in notes:
            if not isinstance(item, dict):
                continue
            text = str(item.get('text') or '').strip()
            if not text:
                continue
            label = str(item.get('label') or '').strip()
            created = str(item.get('createdAt') or '').strip()
            prefix = '- '
            if label:
                prefix += '[' + label + '] '
            if created:
                prefix += '(' + created + ') '
            lines.append(prefix + text)

        return '\n'.join(lines) if lines else '- (keine Notizen)'

    def _build_meeting_concept_prompt(self, project_title, meeting_notes_markdown, existing_data, output_format, language, preset):
        return (
            'Du bist ein Senior Projektstratege. '
            'Erstelle aus Meeting-Notizen ein kompaktes Projektkonzept.\\n\\n'
            'Projekt: ' + project_title + '\\n'
            'Preset: ' + preset + '\\n'
            'Sprache: ' + language + '\\n'
            'Ausgabeformat: ' + output_format + '\\n\\n'
            'Meeting-Notizen:\\n' + meeting_notes_markdown + '\\n\\n'
            'Bestehende Projektdaten (JSON):\\n' + json.dumps(existing_data, ensure_ascii=False, indent=2) + '\\n\\n'
            'Liefere nur die finale Antwort. Keine Analyse, keine Vorrede, kein Meta-Text. '
            'Liefere: Zielbild, Scope, Stakeholder, Risiken, Annahmen, naechste Schritte.'
        )

    def _build_concept_to_plan_prompt(self, project_title, concept_markdown, meeting_notes_markdown, existing_data, output_format, language, preset):
        return (
            'Du bist Projektmanager mit Fokus Umsetzung. '
            'Erzeuge aus dem Konzept aus Stufe 1 und den Meeting-Notizen einen detaillierten Projektplan. '
            'Das Konzept aus Stufe 1 ist die Primärquelle.\n\n'
            'Projekt: ' + project_title + '\\n'
            'Preset: ' + preset + '\\n'
            'Sprache: ' + language + '\\n'
            'Ausgabeformat: ' + output_format + '\\n\\n'
            'Stufe 1 - Konzept:\n' + (concept_markdown or '- (nicht vorhanden)') + '\n\n'
            'Meeting-Notizen:\\n' + meeting_notes_markdown + '\\n\\n'
            'Bestehende Projektdaten (JSON):\\n' + json.dumps(existing_data, ensure_ascii=False, indent=2) + '\\n\\n'
            'Liefere nur die finale Antwort. Keine Analyse, keine Vorrede, kein Meta-Text. '
            'Liefere einen Phasenplan mit Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und einem 6-Wochen-Aktionsplan.'
        )

    def _build_plan_to_tasks_prompt(self, project_title, concept_markdown, plan_markdown, meeting_notes_markdown, existing_data, language, preset):
        return (
            'Du bist ein erfahrener Tech-Lead und Product Owner. '
            'Erzeuge importierbare Aufgaben fuer ein Kanban-Board aus dem Projektplan aus Stufe 2. '
            'Der Plan aus Stufe 2 ist die Primärquelle; das Konzept aus Stufe 1 dient als Kontext.\n\n'
            'Projekt: ' + project_title + '\\n'
            'Preset: ' + preset + '\\n'
            'Sprache: ' + language + '\\n\\n'
            'Stufe 1 - Konzept:\n' + (concept_markdown or '- (nicht vorhanden)') + '\n\n'
            'Stufe 2 - Projektplan:\n' + (plan_markdown or '- (nicht vorhanden)') + '\n\n'
            'Meeting-Notizen:\\n' + meeting_notes_markdown + '\\n\\n'
            'Bestehende Projektdaten (JSON):\\n' + json.dumps(existing_data, ensure_ascii=False, indent=2) + '\\n\\n'
            'Antworte als JSON-Objekt ohne Zusatztext in genau diesem Format:\\n'
            '{\\n'
            '  "summaryMarkdown": "...",\n'
            '  "tasks": [\\n'
            '    {"title":"...","description":"...","status":"todo","priority":"medium","effortHours":4,"labels":["Technisch"],"subtasks":["..."],"sequenceIndex":1,"dependsOnPrevious":false,"schedule":{"mode":"none","deadline":"","fixedAt":"","rangeStart":"","rangeEnd":""}}\n'
            '  ]\\n'
            '}\\n'
            'Wichtig: Gib ausschliesslich das JSON-Objekt zurueck. Kein Markdown, kein Codeblock, keine Analyse, keine Vorrede, kein Erklaerungstext. '
            'Regeln: 6-20 Tasks, realistische Aufwandsschaetzung, Status aus {backlog,todo,in-progress,review,done}, Prioritaet aus {low,medium,high,blocker}, summaryMarkdown maximal 5 knappe Stichpunkte. '
            'Ordne die Aufgaben sauber und setze sequenceIndex fortlaufend ab 1. '
            'Wenn eine Aufgabe logisch auf die vorherige aufbaut, setze dependsOnPrevious=true. '
            'Nutze schedule fuer zeitliche Einordnung, wenn der Plan eine Phase, Deadline oder einen Termin hergibt.'
        )

    def _build_meeting_task_draft_prompt(self, project_title, meeting_notes_markdown, user_input, options, existing_data):
        schedule_mode = str(options.get('scheduleMode') or 'none').strip() or 'none'
        event_type = str(options.get('eventType') or 'meeting').strip() or 'meeting'
        create_subtasks = bool(options.get('createSubtasks'))
        split_multi = bool(options.get('splitIntoMultiple'))
        return (
            'Du bist ein zweisprachiger Projektassistent (Deutsch/Englisch) fuer die operative Aufgabenplanung. '
            'Nutze Meeting-Notizen und User-Input, um eine realistische Aufgabe und optional einen Termin zu entwerfen.\\n\\n'
            'Projekt: ' + project_title + '\\n'
            'Vorgaben aus der UI:\\n'
            '- Terminart (Task-Schedule): ' + schedule_mode + '\\n'
            '- Termin-Typ (Kalender): ' + event_type + '\\n'
            '- Unteraufgaben erzeugen: ' + ('ja' if create_subtasks else 'nein') + '\\n\\n'
            '- Mehrere Aufgaben aufteilen: ' + ('ja' if split_multi else 'nein') + '\\n\\n'
            'Meeting-Notizen:\\n' + meeting_notes_markdown + '\\n\\n'
            'Benutzereingabe:\\n' + user_input + '\\n\\n'
            'Bestehende Projektdaten (JSON):\\n' + json.dumps(existing_data, ensure_ascii=False, indent=2) + '\\n\\n'
            'Wichtig:\\n'
            '- Formuliere praezise, klar und fuer alle Mitarbeiter verstaendlich.\\n'
            '- Liefere Titel und Beschreibung immer in Deutsch UND Englisch.\\n'
            '- Nutze realistische Werte fuer Prioritaet, Dringlichkeit, Aufwand und Labels.\\n'
            '- Wenn Unteraufgaben deaktiviert sind, gib leere Listen fuer subtasksDe/subtasksEn zurueck.\\n'
            '- Wenn "Mehrere Aufgaben aufteilen" = ja und die Eingabe mehrere eigenstaendige Arbeitspakete enthaelt, fuelle taskSuggestions mit 2-8 Aufgaben.\\n'
            '- Nummeriere Hauptaufgabe und Vorschlaege mit sequenceIndex. Setze dependsOnPrevious=true fuer jede Folgeaufgabe, die inhaltlich auf der vorherigen aufbaut.\n'
            '- Wenn keine sinnvolle Aufteilung moeglich ist, liefere taskSuggestions als leeres Array.\\n'
            '- Gib Datumswerte im Format YYYY-MM-DD aus, Zeiten als HH:MM oder leer.\\n'
            '- Erfinde keine harten Fakten, wenn sie nicht aus den Eingaben ableitbar sind.\\n\\n'
            'Antworte nur mit einem gueltigen JSON-Objekt in exakt diesem Format (ohne Markdown, ohne Codeblock):\\n'
            '{\\n'
            '  "summaryMarkdown": "...",\\n'
            '  "task": {\\n'
            '    "titleDe": "...",\\n'
            '    "titleEn": "...",\\n'
            '    "descriptionDe": "...",\\n'
            '    "descriptionEn": "...",\\n'
            '    "priority": "medium",\\n'
            '    "urgency": "normal",\\n'
            '    "effortHours": 3.5,\\n'
            '    "labels": ["..."],\\n'
            '    "schedule": {"mode": "none", "deadline": "", "fixedAt": "", "rangeStart": "", "rangeEnd": ""},\\n'
            '    "sequenceIndex": 1,\n'
            '    "dependsOnPrevious": false,\n'
            '    "subtasksDe": ["..."],\\n'
            '    "subtasksEn": ["..."],\\n'
            '    "note": "..."\\n'
            '  },\\n'
            '  "taskSuggestions": [\\n'
            '    {"titleDe":"...","titleEn":"...","descriptionDe":"...","descriptionEn":"...","priority":"medium","urgency":"normal","effortHours":2,"labels":["..."],"sequenceIndex":1,"dependsOnPrevious":false,"note":"..."}\n'
            '  ],\\n'
            '  "event": {\\n'
            '    "create": true,\\n'
            '    "title": "...",\\n'
            '    "description": "...",\\n'
            '    "type": "meeting",\\n'
            '    "date": "YYYY-MM-DD",\\n'
            '    "startTime": "HH:MM",\\n'
            '    "endTime": "HH:MM"\\n'
            '  }\n'
            '}\n'
            'Wichtig: Nur JSON zurueckgeben. Kein Vorwort, keine Analyse, keine Schritt-fuer-Schritt-Erklaerung.'
        )

    def _build_project_milestones_prompt(self, project_title, project_description, project_status, meeting, queued):
        concept = str(meeting.get('conceptMarkdown') or '').strip()
        plan = str(meeting.get('planMarkdown') or '').strip()
        tasks_summary = str(meeting.get('tasksSummary') or '').strip()
        notes = meeting.get('notes') if isinstance(meeting.get('notes'), list) else []
        queued_tasks = queued.get('tasks') if isinstance(queued.get('tasks'), list) else []
        queued_events = queued.get('events') if isinstance(queued.get('events'), list) else []

        compact_notes = []
        for item in notes[:80]:
            if not isinstance(item, dict):
                continue
            text = str(item.get('text') or '').strip()
            if text:
                compact_notes.append(text)

        context = {
            'projectStatus': project_status,
            'projectDescription': project_description,
            'meetingNotes': compact_notes,
            'conceptMarkdown': concept,
            'planMarkdown': plan,
            'tasksSummary': tasks_summary,
            'queuedTaskCount': len(queued_tasks),
            'queuedEventCount': len(queued_events),
            'queuedTasks': queued_tasks[:40],
            'queuedEvents': queued_events[:40]
        }

        return (
            'Du bist ein Senior Delivery Manager. '\
            'Erzeuge fuer den Projektstart klare Meilensteine zur Ueberwachung von Ablauf und Fortschritt.\n\n'
            'Projekt: ' + project_title + '\n'
            'Status: ' + (project_status or 'unbekannt') + '\n\n'
            'Kontextdaten (JSON):\n' + json.dumps(context, ensure_ascii=False, indent=2) + '\n\n'
            'Anforderungen:\n'
            '- Liefere 3 bis 10 Meilensteine in realistischer Reihenfolge.\n'
            '- Jeder Meilenstein braucht Titel, Datum (YYYY-MM-DD) und kurze Beschreibung.\n'
            '- StartTime/EndTime optional als HH:MM, sonst leer.\n'
            '- Nutze nur Informationen aus den Eingaben; keine erfundenen Fakten.\n\n'
            'Antworte ausschliesslich als JSON-Objekt in exakt diesem Format:\n'
            '{\n'
            '  "summaryMarkdown": "...",\n'
            '  "milestones": [\n'
            '    {"title":"...","description":"...","date":"YYYY-MM-DD","startTime":"","endTime":"","type":"release"}\n'
            '  ]\n'
            '}\n'
            'Nur JSON, kein Markdown-Codeblock, keine Vorrede.'
        )

    def _extract_meeting_task_draft_payload(self, raw_text, options):
        text = str(raw_text or '').strip()
        fallback_schedule_mode = self._normalize_schedule_mode(str(options.get('scheduleMode') or 'none'))
        fallback_event_type = self._normalize_event_type(str(options.get('eventType') or 'meeting'))
        fallback = {
            'summaryMarkdown': text,
            'task': {
                'titleDe': '',
                'titleEn': '',
                'descriptionDe': '',
                'descriptionEn': '',
                'priority': 'medium',
                'urgency': 'normal',
                'effortHours': 0,
                'labels': [],
                'sequenceIndex': 1,
                'dependsOnPrevious': False,
                'schedule': {
                    'mode': fallback_schedule_mode,
                    'deadline': '',
                    'fixedAt': '',
                    'rangeStart': '',
                    'rangeEnd': ''
                },
                'subtasksDe': [],
                'subtasksEn': [],
                'note': ''
            },
            'taskSuggestions': [],
            'event': {
                'create': False,
                'title': '',
                'description': '',
                'type': fallback_event_type,
                'date': '',
                'startTime': '',
                'endTime': ''
            }
        }

        if not text:
            return fallback

        payload = self._extract_json_object(text)

        if not isinstance(payload, dict):
            return fallback

        task = payload.get('task') if isinstance(payload.get('task'), dict) else {}
        task_suggestions = payload.get('taskSuggestions') if isinstance(payload.get('taskSuggestions'), list) else []
        event = payload.get('event') if isinstance(payload.get('event'), dict) else {}
        schedule = task.get('schedule') if isinstance(task.get('schedule'), dict) else {}

        schedule_mode = self._normalize_schedule_mode(str(schedule.get('mode') or fallback_schedule_mode))
        normalized = {
            'summaryMarkdown': str(payload.get('summaryMarkdown') or '').strip() or text,
            'task': {
                'titleDe': str(task.get('titleDe') or '').strip(),
                'titleEn': str(task.get('titleEn') or '').strip(),
                'descriptionDe': str(task.get('descriptionDe') or '').strip(),
                'descriptionEn': str(task.get('descriptionEn') or '').strip(),
                'priority': self._normalize_priority(str(task.get('priority') or 'medium')),
                'urgency': self._normalize_urgency(str(task.get('urgency') or 'normal')),
                'effortHours': self._normalize_effort(task.get('effortHours')),
                'labels': self._normalize_string_list(task.get('labels')),
                'sequenceIndex': self._normalize_sequence_index(task.get('sequenceIndex')),
                'dependsOnPrevious': bool(task.get('dependsOnPrevious')),
                'schedule': {
                    'mode': schedule_mode,
                    'deadline': self._normalize_date_value(schedule.get('deadline')),
                    'fixedAt': self._normalize_date_value(schedule.get('fixedAt')),
                    'rangeStart': self._normalize_date_value(schedule.get('rangeStart')),
                    'rangeEnd': self._normalize_date_value(schedule.get('rangeEnd'))
                },
                'subtasksDe': self._normalize_string_list(task.get('subtasksDe')),
                'subtasksEn': self._normalize_string_list(task.get('subtasksEn')),
                'note': str(task.get('note') or '').strip()
            },
            'taskSuggestions': self._normalize_task_suggestions(task_suggestions),
            'event': {
                'create': bool(event.get('create')),
                'title': str(event.get('title') or '').strip(),
                'description': str(event.get('description') or '').strip(),
                'type': self._normalize_event_type(str(event.get('type') or fallback_event_type)),
                'date': self._normalize_date_value(event.get('date')),
                'startTime': self._normalize_time_value(event.get('startTime')),
                'endTime': self._normalize_time_value(event.get('endTime'))
            }
        }

        if not bool(options.get('createSubtasks')):
            normalized['task']['subtasksDe'] = []
            normalized['task']['subtasksEn'] = []

        return normalized

    def _normalize_priority(self, value):
        allowed = {'low', 'medium', 'high', 'blocker'}
        cleaned = str(value or '').strip().lower()
        return cleaned if cleaned in allowed else 'medium'

    def _normalize_urgency(self, value):
        allowed = {'low', 'normal', 'high', 'critical'}
        cleaned = str(value or '').strip().lower()
        return cleaned if cleaned in allowed else 'normal'

    def _normalize_schedule_mode(self, value):
        allowed = {'none', 'deadline', 'fixed', 'range', 'asap'}
        cleaned = str(value or '').strip().lower()
        return cleaned if cleaned in allowed else 'none'

    def _normalize_event_type(self, value):
        allowed = {'meeting', 'deadline', 'release', 'holiday', 'task'}
        cleaned = str(value or '').strip().lower()
        return cleaned if cleaned in allowed else 'meeting'

    def _normalize_effort(self, value):
        try:
            parsed = float(value)
        except Exception:
            return 0
        if parsed < 0:
            return 0
        return round(parsed, 2)

    def _normalize_sequence_index(self, value):
        try:
            parsed = int(float(value))
        except Exception:
            return 0
        if parsed < 0:
            return 0
        return parsed

    def _normalize_string_list(self, value):
        if not isinstance(value, list):
            return []
        out = []
        for item in value:
            text = str(item or '').strip()
            if not text:
                continue
            if text not in out:
                out.append(text)
        return out

    def _normalize_date_value(self, value):
        text = str(value or '').strip()
        if re.match(r'^\d{4}-\d{2}-\d{2}$', text):
            return text
        return ''

    def _normalize_task_suggestions(self, suggestions):
        if not isinstance(suggestions, list):
            return []
        out = []
        for item in suggestions:
            if not isinstance(item, dict):
                continue
            title_de = str(item.get('titleDe') or '').strip()
            title_en = str(item.get('titleEn') or '').strip()
            if not title_de and not title_en:
                continue
            out.append({
                'titleDe': title_de,
                'titleEn': title_en,
                'descriptionDe': str(item.get('descriptionDe') or '').strip(),
                'descriptionEn': str(item.get('descriptionEn') or '').strip(),
                'priority': self._normalize_priority(str(item.get('priority') or 'medium')),
                'urgency': self._normalize_urgency(str(item.get('urgency') or 'normal')),
                'effortHours': self._normalize_effort(item.get('effortHours')),
                'labels': self._normalize_string_list(item.get('labels')),
                'sequenceIndex': self._normalize_sequence_index(item.get('sequenceIndex')),
                'dependsOnPrevious': bool(item.get('dependsOnPrevious')),
                'note': str(item.get('note') or '').strip()
            })
        return out[:8]

    def _normalize_time_value(self, value):
        text = str(value or '').strip()
        if re.match(r'^\d{2}:\d{2}$', text):
            return text
        return ''

    def _extract_project_milestones_payload(self, raw_text):
        text = str(raw_text or '').strip()
        fallback = {'summaryMarkdown': text, 'milestones': []}
        if not text:
            return fallback

        payload = self._extract_json_object(text)
        if not isinstance(payload, dict):
            return fallback

        milestones = payload.get('milestones') if isinstance(payload.get('milestones'), list) else []
        normalized = []
        for item in milestones:
            if not isinstance(item, dict):
                continue
            title = str(item.get('title') or item.get('name') or '').strip()
            if not title:
                continue
            date = self._normalize_date_value(item.get('date'))
            if not date:
                continue
            normalized.append({
                'title': title,
                'description': str(item.get('description') or '').strip(),
                'date': date,
                'startTime': self._normalize_time_value(item.get('startTime')),
                'endTime': self._normalize_time_value(item.get('endTime')),
                'type': 'release'
            })

        return {
            'summaryMarkdown': str(payload.get('summaryMarkdown') or '').strip() or text,
            'milestones': normalized[:12]
        }

    def _persist_pipeline_result(self, project_id, project_title, stage, model, prompt, content):
        generated_at = utc_now_iso_z()
        stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        file_name = self._safe_file_name(project_id + '-' + project_title + '-' + stage + '-' + stamp) + '.md'
        relative_path = os.path.join('data', 'project-knowledge', file_name).replace('\\', '/')
        full_path = os.path.join(ROOT, relative_path)

        header = [
            '# KI Aufarbeitung',
            '',
            '- Projekt-ID: ' + project_id,
            '- Projekt: ' + project_title,
            '- Stufe: ' + stage,
            '- Modell: ' + model,
            '- Generiert am: ' + generated_at,
            ''
        ]
        document = '\n'.join(header) + '\n## Prompt\n\n```\n' + prompt.strip() + '\n```\n\n## Ergebnis\n\n' + content.strip() + '\n'

        with open(full_path, 'w', encoding='utf-8') as handle:
            handle.write(document)

        return {
            'generatedAt': generated_at,
            'filePath': '/' + relative_path,
            'bytes': len(document.encode('utf-8'))
        }

    def _extract_task_payload(self, raw_text):
        text = str(raw_text or '').strip()
        fallback = {'markdown': text, 'tasks': []}
        if not text:
            return fallback

        direct = self._try_parse_task_json(text)
        if direct:
            return direct

        fenced_match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', text, re.IGNORECASE)
        if fenced_match:
            parsed = self._try_parse_task_json(fenced_match.group(1))
            if parsed:
                return parsed

        return fallback

    def _try_parse_task_json(self, candidate):
        payload = self._extract_json_object(candidate)
        if payload is None:
            return None
        if not isinstance(payload, dict):
            return None

        tasks = payload.get('tasks') if isinstance(payload.get('tasks'), list) else []
        normalized_tasks = []
        for item in tasks:
            if not isinstance(item, dict):
                continue
            title = str(item.get('title') or '').strip()
            if not title:
                continue
            normalized_tasks.append({
                'title': title,
                'description': str(item.get('description') or '').strip(),
                'status': str(item.get('status') or 'todo').strip(),
                'priority': str(item.get('priority') or 'medium').strip(),
                'effortHours': item.get('effortHours') if isinstance(item.get('effortHours'), (int, float)) else 0,
                'labels': item.get('labels') if isinstance(item.get('labels'), list) else [],
                'subtasks': item.get('subtasks') if isinstance(item.get('subtasks'), list) else []
            })

        return {
            'markdown': str(payload.get('summaryMarkdown') or '').strip() or json.dumps(payload, ensure_ascii=False, indent=2),
            'tasks': normalized_tasks
        }

    def _extract_json_object(self, text):
        source = str(text or '').strip()
        if not source:
            return None

        try:
            return json.loads(source)
        except Exception:
            pass

        fenced_match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', source, re.IGNORECASE)
        if fenced_match:
            try:
                return json.loads(fenced_match.group(1))
            except Exception:
                pass

        start = source.find('{')
        if start == -1:
            return None

        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(source)):
            char = source[index]
            if in_string:
                if escape:
                    escape = False
                elif char == '\\':
                    escape = True
                elif char == '"':
                    in_string = False
                continue

            if char == '"':
                in_string = True
                continue
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    candidate = source[start:index + 1]
                    try:
                        return json.loads(candidate)
                    except Exception:
                        return None

        return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-GitHub-Token')
        self.end_headers()

    def log_message(self, fmt, *args):
        return

    def _handle_github_repo_get(self, parsed):
        params = parse_qs(parsed.query or '')
        owner = str((params.get('owner') or [''])[0]).strip()
        repo = str((params.get('repo') or [''])[0]).strip()
        if not owner or not repo:
            self._send_json({'error': 'owner and repo are required.'}, status=400)
            return

        token = self._read_github_token_header()
        endpoint = GITHUB_API_BASE + '/repos/' + owner + '/' + repo
        self._proxy_github_json(endpoint, token)

    def _handle_github_commits_get(self, parsed):
        params = parse_qs(parsed.query or '')
        owner = str((params.get('owner') or [''])[0]).strip()
        repo = str((params.get('repo') or [''])[0]).strip()
        per_page_raw = str((params.get('per_page') or ['100'])[0]).strip()
        page_raw = str((params.get('page') or ['1'])[0]).strip()
        if not owner or not repo:
            self._send_json({'error': 'owner and repo are required.'}, status=400)
            return

        try:
            per_page = int(per_page_raw)
        except Exception:
            per_page = 100
        per_page = max(1, min(100, per_page))

        try:
            page = int(page_raw)
        except Exception:
            page = 1
        page = max(1, page)

        token = self._read_github_token_header()
        endpoint = GITHUB_API_BASE + '/repos/' + owner + '/' + repo + '/commits?' + urlencode({'per_page': per_page, 'page': page})
        self._proxy_github_json(endpoint, token)

    def _read_github_token_header(self):
        return str(self.headers.get('X-GitHub-Token', '') or '').strip()

    def _proxy_github_json(self, endpoint, token=''):
        headers = {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'projekt-dashboard-storage-server'
        }
        if token:
            headers['Authorization'] = 'Bearer ' + token

        request = urllib.request.Request(endpoint, method='GET', headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read().decode('utf-8')
            payload = json.loads(raw) if raw else {}
            self._send_json(payload, status=200)
        except urllib.error.HTTPError as exc:
            details = exc.read().decode('utf-8', errors='ignore')
            parsed = {}
            if details:
                try:
                    parsed = json.loads(details)
                except Exception:
                    parsed = {}

            message = str(parsed.get('message') or details or ('HTTP ' + str(exc.code))).strip()
            if exc.code == 404 and message.lower() == 'not found':
                message = 'Repository nicht gefunden oder kein Zugriff (privat ohne gueltigen Token).'
            elif exc.code == 401:
                message = 'GitHub-Authentifizierung fehlgeschlagen. Bitte Token pruefen.'
            elif exc.code == 403 and 'rate limit' in message.lower():
                message = 'GitHub API Rate Limit erreicht. Bitte spaeter erneut versuchen.'

            self._send_json({'error': message, 'status': exc.code}, status=exc.code)
        except Exception as exc:
            self._send_json({'error': 'GitHub API nicht erreichbar: ' + str(exc)}, status=502)

    def _build_project_prompt(self, project_title, github, snapshot):
        repo_line = ''
        if github.get('url'):
            repo_line = 'Repository: ' + str(github.get('url'))

        snapshot_json = json.dumps(snapshot, ensure_ascii=False, indent=2)
        return (
            'Du bist ein Senior Technical Program Assistant. '
            'Erstelle aus den gelieferten Projektdaten ein kompaktes, KI-effizientes Projektwissen.\\n\\n'
            'Ausgabeformat (Markdown) mit genau diesen Bereichen:\\n'
            '1) Projektkontext\\n'
            '2) Aktueller technischer Stand\\n'
            '3) Offene Aufgaben und Luecken\\n'
            '4) Risiken und Blocker\\n'
            '5) Naechste 10 voraussichtliche Aufgaben (priorisiert)\\n'
            '6) Empfohlenes Sprint-Backlog (max. 12 Punkte)\\n'
            '7) Wissens-Shortcuts fuer Folge-LLM-Prompts (Stichpunkte)\\n\\n'
            'Regeln:\\n'
            '- Schreibe praezise auf Deutsch.\\n'
            '- Erfinde keine Fakten, nutze nur Eingabedaten.\\n'
            '- Wenn Daten fehlen, markiere es als "Unbekannt".\\n'
            '- Formuliere umsetzbar fuer Entwicklerteams.\\n\\n'
            'Projekt: ' + project_title + '\\n'
            + repo_line + '\\n\\n'
            + 'Projektdaten (JSON):\\n'
            + snapshot_json
        )

    def _build_knowledge_document(self, project_id, project_title, github, generated_at, model, ai_text):
        repo_line = github.get('url') if isinstance(github, dict) else ''
        header = [
            '# Projektwissen KI',
            '',
            '- Projekt-ID: ' + project_id,
            '- Projekt: ' + project_title,
            '- Repository: ' + (repo_line or 'nicht verknuepft'),
            '- Generiert am: ' + generated_at,
            '- Modell: ' + model,
            ''
        ]
        text = ai_text
        if isinstance(text, tuple):
            text = text[0] if text else ''
        if not isinstance(text, str):
            text = str(text or '')
        return '\\n'.join(header) + '\\n' + text.strip() + '\\n'

    def _call_ollama(self, model, prompt, temperature=0.2, max_tokens=1400, response_format=None):
        endpoint = OLLAMA_BASE_URL + '/api/generate'
        payload = {
            'model': model,
            'prompt': prompt,
            'stream': True,
            'options': {
                'temperature': max(0.0, min(1.0, float(temperature))),
                'num_predict': max(200, min(6000, int(max_tokens)))
            }
        }
        if response_format:
            payload['format'] = response_format
        data = json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(
            endpoint,
            data=data,
            method='POST',
            headers={'Content-Type': 'application/json'}
        )

        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                chunks = []
                collected = []
                for raw_line in response:
                    line = raw_line.decode('utf-8', errors='ignore').strip()
                    if not line:
                        continue
                    try:
                        piece = json.loads(line)
                    except Exception:
                        continue
                    text = str(piece.get('response') or '')
                    if text:
                        chunks.append(text)
                        collected.append(text)
                    if piece.get('done'):
                        break
                body = {'response': ''.join(collected)}
        except urllib.error.HTTPError as exc:
            details = exc.read().decode('utf-8', errors='ignore')
            raise RuntimeError('Ollama HTTP Fehler ' + str(exc.code) + ': ' + details)
        except Exception as exc:
            raise RuntimeError('Ollama nicht erreichbar unter ' + OLLAMA_BASE_URL + ': ' + str(exc))

        text = str(body.get('response') or '').strip()
        if not text:
            raise RuntimeError('Ollama lieferte keine Antwort. Bitte Modell und Runtime pruefen.')
        return text, chunks

    def _check_ai_health(self):
        endpoint = OLLAMA_BASE_URL + '/api/tags'
        request = urllib.request.Request(endpoint, method='GET')
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                body = json.loads(response.read().decode('utf-8'))
            return {
                'status': 'ok',
                'ollamaBaseUrl': OLLAMA_BASE_URL,
                'models': body.get('models', [])
            }
        except Exception as exc:
            return {
                'status': 'error',
                'ollamaBaseUrl': OLLAMA_BASE_URL,
                'error': str(exc)
            }

    def _safe_file_name(self, value):
        safe = re.sub(r'[^A-Za-z0-9._-]+', '-', value or '').strip('-')
        if not safe:
            safe = 'project'
        return safe[:80]

    def _read_all(self):
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute('SELECT key, value FROM kv_store ORDER BY key').fetchall()
        conn.close()
        return {key: value for key, value in rows}

    def _write_value(self, key, value):
        conn = sqlite3.connect(DB_PATH)
        if value is None:
            conn.execute('DELETE FROM kv_store WHERE key = ?', (key,))
        else:
            conn.execute(
                'INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)',
                (key, str(value), utc_now_iso_z())
            )
        conn.commit()
        conn.close()

    def _clear_all_values(self):
        conn = sqlite3.connect(DB_PATH)
        conn.execute('DELETE FROM kv_store')
        conn.commit()
        conn.close()

    def _send_json(self, data, status=200):
        payload = json.dumps(data).encode('utf-8')
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            # Client connection closed before the response was fully written.
            return

    def _serve_static(self, path):
        if path in ('', '/'):
            path = '/app.html'
        if path.startswith('/'):
            path = path[1:]
        if path.startswith('..'):
            self.send_response(403)
            self.end_headers()
            return

        full_path = os.path.join(ROOT, path)
        if not os.path.exists(full_path) or os.path.isdir(full_path):
            self.send_response(404)
            self.end_headers()
            return

        with open(full_path, 'rb') as handle:
            content = handle.read()

        self.send_response(200)
        self.send_header('Content-Type', self._mime_type(full_path))
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _mime_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.md': 'text/markdown; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
        }.get(ext, 'application/octet-stream')


if __name__ == '__main__':
    httpd = ThreadingHTTPServer((HOST, PORT), StorageHandler)
    print(f'Storage server listening on http://{HOST}:{PORT}')
    httpd.serve_forever()
