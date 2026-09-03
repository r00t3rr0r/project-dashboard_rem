import json
import base64
import gzip
import os
import re
import hmac
import queue
import sqlite3
import shutil
import socket
import sys
import threading
import uuid
import urllib.error
import subprocess
import tempfile
import time
import urllib.request
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse, quote

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.sqlite')
BACKUP_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.backup.sqlite')
BACKUP_JSON_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.backup.json')
BACKUP_STAMP_PATH = os.path.join(ROOT, 'data', 'projekt-dashboard.backup.stamp')
KV_SNAPSHOT_PATH = os.path.join(ROOT, 'data', '.projekt-dashboard.snapshot.json')
KV_SNAPSHOT_GZIP_PATH = KV_SNAPSHOT_PATH + '.gz'
KNOWLEDGE_DIR = os.path.join(ROOT, 'data', 'project-knowledge')
MEETINGS_DIR = os.path.join(ROOT, 'data', 'meetings')
HOST = os.environ.get('PROJECT_DASHBOARD_STORAGE_HOST', '0.0.0.0')
PORT = int(os.environ.get('PROJECT_DASHBOARD_STORAGE_PORT', '8766'))
ADMIN_PIN = str(os.environ.get('PROJECT_DASHBOARD_ADMIN_PIN', '1337'))
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M')
OLLAMA_AUTOSTART = str(os.environ.get('PROJECT_DASHBOARD_OLLAMA_AUTOSTART', '1')).strip().lower() not in ('0', 'false', 'no')
ROUTINE_EXECUTION_ENABLED = str(os.environ.get('PROJECT_DASHBOARD_ROUTINE_EXECUTION', '0')).strip().lower() in ('1', 'true', 'yes')
GITHUB_API_BASE = 'https://api.github.com'
TRUSTED_ORIGINS_ENV = str(os.environ.get('PROJECT_DASHBOARD_TRUSTED_ORIGINS', '') or '').strip()
BOOTSTRAP_STATUS = {
    'dbRestore': {'restored': False, 'source': 'unknown', 'rows': 0},
    'ollama': {'status': 'unknown', 'autostart': OLLAMA_AUTOSTART, 'detail': ''}
}
STORAGE_LOCK = threading.RLock()
BACKUP_SCHEDULE_LOCK = threading.Lock()
BACKUP_RUN_LOCK = threading.Lock()
BACKUP_TIMER = None
BACKUP_DELAY_SECONDS = max(0.1, float(os.environ.get('PROJECT_DASHBOARD_BACKUP_DELAY_SECONDS', '1.0')))
KV_SNAPSHOT_LOCK = threading.Lock()
KV_SNAPSHOT_METADATA = None
KV_SNAPSHOT_REVISION = 0
KV_STREAM_CHUNK_SIZE = 64 * 1024


def utc_now_iso_z():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def open_db_connection(path=None):
    if path is None:
        path = DB_PATH
    conn = sqlite3.connect(path, timeout=10)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=10000')
    conn.execute('PRAGMA synchronous=FULL')
    return conn


def _fsync_directory(path):
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_file(path):
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write_text(path, content):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    descriptor, temp_path = tempfile.mkstemp(prefix='.' + os.path.basename(path) + '.', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        _fsync_directory(directory)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def _commit_durably(conn):
    conn.commit()


def schedule_full_backup():
    global BACKUP_TIMER

    def run_backup():
        global BACKUP_TIMER
        try:
            ensure_daily_backup(force=True)
        except Exception as exc:
            print('[Storage] Background backup failed: ' + str(exc))
        finally:
            with BACKUP_SCHEDULE_LOCK:
                BACKUP_TIMER = None

    with BACKUP_SCHEDULE_LOCK:
        if BACKUP_TIMER is not None:
            return
        BACKUP_TIMER = threading.Timer(BACKUP_DELAY_SECONDS, run_backup)
        BACKUP_TIMER.daemon = True
        BACKUP_TIMER.start()


def _read_kv_rows(path):
    if not os.path.exists(path):
        return []
    try:
        conn = open_db_connection(path)
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
    with STORAGE_LOCK:
        conn = open_db_connection(DB_PATH)
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
                _commit_durably(conn)
                return {'restored': True, 'source': 'backup-sqlite', 'rows': len(rows)}

            kv_payload = _read_kv_json(BACKUP_JSON_PATH)
            if kv_payload:
                now = utc_now_iso_z()
                conn.executemany(
                    'INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)',
                    [(key, value, now) for key, value in kv_payload.items()]
                )
                _commit_durably(conn)
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
    with BACKUP_RUN_LOCK:
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

        backup_descriptor, backup_temp_path = tempfile.mkstemp(
            prefix='.projekt-dashboard.backup.', suffix='.sqlite.tmp', dir=os.path.dirname(BACKUP_PATH)
        )
        os.close(backup_descriptor)
        try:
            source_conn = open_db_connection(DB_PATH)
            backup_conn = sqlite3.connect(backup_temp_path, timeout=10)
            backup_conn.execute('PRAGMA journal_mode=DELETE')
            backup_conn.execute('PRAGMA synchronous=FULL')
            try:
                source_conn.backup(backup_conn)
                backup_conn.commit()
            finally:
                backup_conn.close()
                source_conn.close()
            _fsync_file(backup_temp_path)
            os.replace(backup_temp_path, BACKUP_PATH)
            _fsync_directory(os.path.dirname(BACKUP_PATH))
        except Exception:
            try:
                os.unlink(backup_temp_path)
            except OSError:
                pass
            raise

        snapshot_conn = open_db_connection(DB_PATH)
        try:
            rows = snapshot_conn.execute('SELECT key, value FROM kv_store ORDER BY key').fetchall()
            payload = {
                'exportedAt': utc_now_iso_z(),
                'data': {key: value for key, value in rows}
            }
            _atomic_write_text(BACKUP_JSON_PATH, json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
        finally:
            snapshot_conn.close()

        _atomic_write_text(BACKUP_STAMP_PATH, today)
        return True


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
    os.makedirs(MEETINGS_DIR, exist_ok=True)
    with STORAGE_LOCK:
        conn = open_db_connection(DB_PATH)
        try:
            conn.execute('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL)')
            _commit_durably(conn)
        finally:
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


def _build_trusted_origins():
    defaults = {
        'http://127.0.0.1:' + str(PORT),
        'http://localhost:' + str(PORT)
    }
    configured = set()
    if TRUSTED_ORIGINS_ENV:
        for item in TRUSTED_ORIGINS_ENV.split(','):
            value = str(item or '').strip().rstrip('/')
            if value:
                configured.add(value)
    return defaults.union(configured)


TRUSTED_ORIGINS = _build_trusted_origins()

KV_STREAM_SUBSCRIBERS = set()
KV_STREAM_LOCK = threading.Lock()
KV_STREAM_SEQ = 0


def _next_kv_stream_event(action, key=''):
    global KV_STREAM_SEQ
    with KV_STREAM_LOCK:
        KV_STREAM_SEQ += 1
        event = {
            'seq': KV_STREAM_SEQ,
            'action': str(action or 'set'),
            'key': str(key or ''),
            'updatedAt': utc_now_iso_z()
        }
        subscribers = list(KV_STREAM_SUBSCRIBERS)

    for subscriber in subscribers:
        try:
            subscriber.put_nowait(event)
        except queue.Full:
            # Slow consumers can safely miss old events because clients refresh
            # from the full KV snapshot after receiving a newer event.
            continue


def _register_kv_stream_subscriber(subscriber):
    with KV_STREAM_LOCK:
        KV_STREAM_SUBSCRIBERS.add(subscriber)


def _unregister_kv_stream_subscriber(subscriber):
    with KV_STREAM_LOCK:
        KV_STREAM_SUBSCRIBERS.discard(subscriber)


class StorageHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        ensure_daily_backup()
        parsed = urlparse(self.path)
        if parsed.path == '/api/kv/stream':
            if not self._require_admin_pin_for_request(parsed.path, parsed=parsed):
                return
            self._handle_kv_stream()
            return
        if not self._require_admin_pin_for_request(parsed.path):
            return
        meeting_project_id = self._extract_meeting_project_id(parsed.path)
        if meeting_project_id:
            self._handle_meetings_get(meeting_project_id)
            return
        if parsed.path == '/api/auth/validate':
            self._send_json({'ok': True})
            return
        if parsed.path == '/api/kv':
            if 'key' in parse_qs(parsed.query or '', keep_blank_values=True):
                self._send_kv_value(parsed)
                return
            self._send_kv_snapshot()
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
        if not self._is_request_origin_allowed():
            self._send_json({'error': 'Origin not allowed.'}, status=403)
            return
        parsed = urlparse(self.path)
        if not self._require_admin_pin_for_request(parsed.path):
            return
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
        if parsed.path == '/api/github/e2e-workflow':
            self._handle_github_e2e_workflow_post()
            return
        if parsed.path == '/api/routines/execute':
            self._handle_routine_execute_post()
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
            try:
                self._clear_all_values()
            except Exception as exc:
                print('[Storage] Durable clear failed: ' + str(exc))
                self._send_json({'error': 'Serverseitige Speicherung fehlgeschlagen.'}, status=500)
                return
            _next_kv_stream_event('clear', '')
            self._send_json({'ok': True, 'cleared': True})
            return

        key = payload.get('key')
        value = payload.get('value')
        if not key:
            self._send_json({'error': 'Missing key'}, status=400)
            return

        try:
            self._write_value(key, value)
        except Exception as exc:
            print('[Storage] Durable write failed for key {key}: {error}'.format(key=key, error=exc))
            self._send_json({'error': 'Serverseitige Speicherung fehlgeschlagen.'}, status=500)
            return
        _next_kv_stream_event('delete' if value is None else 'set', key)
        self._send_json({'ok': True, 'key': key})

    def _handle_kv_stream(self):
        subscriber = queue.Queue(maxsize=256)
        _register_kv_stream_subscriber(subscriber)

        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self._apply_cors_headers()
            self._apply_security_headers()
            self.end_headers()

            self._write_sse_event('ready', {
                'seq': 0,
                'action': 'ready',
                'key': '',
                'updatedAt': utc_now_iso_z()
            })

            while True:
                try:
                    event = subscriber.get(timeout=20)
                    self._write_sse_event('kv-update', event)
                except queue.Empty:
                    self.wfile.write(b': keep-alive\n\n')
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            _unregister_kv_stream_subscriber(subscriber)

    def _write_sse_event(self, event_name, payload):
        body = ''
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False)
        chunk = ('event: ' + str(event_name or 'message') + '\n' + 'data: ' + body + '\n\n').encode('utf-8')
        self.wfile.write(chunk)
        self.wfile.flush()

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

        _atomic_write_text(full_path, document)

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

        _atomic_write_text(
            self._meeting_file_path(project_id),
            json.dumps(record, ensure_ascii=False, indent=2) + '\n'
        )

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

        user_title = str(payload.get('draftTitle') or '').strip()
        user_description = str(payload.get('draftDescription') or '').strip()
        user_input = str(payload.get('draftInput') or '').strip()
        if not user_input:
            if user_title or user_description:
                user_input = 'Titel: ' + user_title
                if user_description:
                    user_input += '\n\nBeschreibung:\n' + user_description
            else:
                self._send_json({'error': 'draftInput is required.'}, status=400)
                return

        note_markdown = self._meeting_notes_markdown(payload)
        existing_data = payload.get('existingData') if isinstance(payload.get('existingData'), dict) else {}
        generated_prompt = str(prompt_config.get('prompt') or '').strip()
        if not generated_prompt:
            generated_prompt = self._build_meeting_task_draft_prompt(
                project_title=project_title,
                meeting_notes_markdown=note_markdown,
                user_title=user_title,
                user_description=user_description,
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
            'Du bist ein Senior IT-Projektstratege mit Fokus Softwareentwicklung. '
            'Erstelle aus Meeting-Notizen ein kompaktes Projektkonzept, das direkt als Grundlage fuer die nachfolgenden Stufen (Projektplan und Entwicklungs-Tasks) dient.\\n\\n'
            'Projekt: ' + project_title + '\\n'
            'Preset: ' + preset + '\\n'
            'Sprache: ' + language + '\\n'
            'Ausgabeformat: ' + output_format + '\\n\\n'
            'Meeting-Notizen:\\n' + meeting_notes_markdown + '\\n\\n'
            'Bestehende Projektdaten (JSON):\\n' + json.dumps(existing_data, ensure_ascii=False, indent=2) + '\\n\\n'
            'Liefere nur die finale Antwort. Keine Analyse, keine Vorrede, kein Meta-Text. '
            'Liefere: Zielbild, Scope, Stakeholder, Risiken, Annahmen, naechste Schritte. '
            'Plane aus Sicht eines IT-Mitarbeiters (reale Entwicklungsarbeit, keine abstrakten Management-Floskeln). '
            'Benenne im Scope und in den naechsten Schritten bereits implementierungsnahe Arbeitspakete inkl. grober Aufwand-/Zeitrahmen-Hinweise (z. B. kurzfristig, diese Woche, innerhalb 2-6 Wochen).'
        )

    def _build_concept_to_plan_prompt(self, project_title, concept_markdown, meeting_notes_markdown, existing_data, output_format, language, preset):
        return (
            'Du bist IT-Projektmanager mit Fokus Umsetzung im Entwicklungsteam. '
            'Erzeuge aus dem Konzept aus Stufe 1 und den Meeting-Notizen einen detaillierten Projektplan als Startplan fuer die technische Umsetzung. '
            'Das Konzept aus Stufe 1 ist die Primärquelle.\n\n'
            'Projekt: ' + project_title + '\\n'
            'Preset: ' + preset + '\\n'
            'Sprache: ' + language + '\\n'
            'Ausgabeformat: ' + output_format + '\\n\\n'
            'Stufe 1 - Konzept:\n' + (concept_markdown or '- (nicht vorhanden)') + '\n\n'
            'Meeting-Notizen:\\n' + meeting_notes_markdown + '\\n\\n'
            'Bestehende Projektdaten (JSON):\\n' + json.dumps(existing_data, ensure_ascii=False, indent=2) + '\\n\\n'
            'Liefere nur die finale Antwort. Keine Analyse, keine Vorrede, kein Meta-Text. '
            'Liefere einen Phasenplan mit Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und einem 6-Wochen-Aktionsplan. '
            'Fuehre je Phase kurz auf: erwarteter Entwicklungsaufwand (Personenstunden) und geplanter Zeitraum. '
            'Ergaenze einen klaren Startplan fuer die ersten 10 Arbeitstage mit priorisierten technischen Schritten und erwarteten Ergebnissen.'
        )

    def _build_plan_to_tasks_prompt(self, project_title, concept_markdown, plan_markdown, meeting_notes_markdown, existing_data, language, preset):
        return (
            'Du bist ein erfahrener Tech-Lead und Product Owner in einem IT-Team. '
            'Erzeuge importierbare, konkrete Entwicklungsaufgaben fuer ein Kanban-Board aus dem Projektplan aus Stufe 2. '
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
            'Wenn eine Aufgabe logisch auf die vorherige aufbaut, setze dependsOnPrevious=true (Aufgabenkette). '
            'Nutze in jeder Antwort beide Strukturmoeglichkeiten: Teilaufgaben UND mindestens eine Aufgabenkette mit klarer Reihenfolge. '
            'Jede Aufgabe muss eine sinnvolle effortHours-Sollzeit > 0 enthalten. '
            'Gib pro Aufgabe immer 2-8 passende subtasks an (kurz, konkret, umsetzbar). '
            'Halte die Anzahl einzelner Hauptaufgaben uebersichtlich, indem Arbeitsschritte bevorzugt als subtasks innerhalb der Aufgabe strukturiert werden. '
            'Auch Aufgaben in einer Aufgabenkette muessen eigene subtasks enthalten. '
            'Nutze schedule fuer zeitliche Einordnung: wenn moeglich deadline/fixed/range/asap statt none. '
            'Formuliere jede Aufgabe als reale Entwicklerarbeit (Analyse, Implementierung, Tests, Review, Deployment-Vorbereitung) und nicht als abstrakte Epic-Ueberschrift. '
            'Beschreibe in summaryMarkdown den geplanten Gesamtaufwand und den vorgesehenen Lieferzeitraum in knapper Form.'
        )

    def _build_default_subtasks(self, title, description):
        title_text = str(title or '').strip()
        description_text = str(description or '').strip()

        candidates = []
        if description_text:
            for piece in re.split(r'[\n\r;]+', description_text):
                line = str(piece or '').strip(' -\t')
                if len(line) < 6:
                    continue
                if line not in candidates:
                    candidates.append(line)
                if len(candidates) >= 8:
                    break

        if len(candidates) < 2:
            base = title_text or 'Aufgabe'
            fallback = [
                'Anforderungen und Akzeptanzkriterien fuer "' + base + '" klaeren',
                'Implementierung fuer "' + base + '" umsetzen',
                'Tests, Review und Dokumentation fuer "' + base + '" abschliessen'
            ]
            for item in fallback:
                if item not in candidates:
                    candidates.append(item)

        return candidates[:8]

    def _build_meeting_task_draft_prompt(self, project_title, meeting_notes_markdown, user_input, options, existing_data, user_title='', user_description=''):
        schedule_mode = str(options.get('scheduleMode') or 'none').strip() or 'none'
        event_type = str(options.get('eventType') or 'meeting').strip() or 'meeting'
        create_subtasks = bool(options.get('createSubtasks'))
        split_multi = bool(options.get('splitIntoMultiple'))
        planning_style = str(options.get('planningStyle') or '').strip().lower()
        estimate_from_subtasks = bool(options.get('estimateEffortFromSubtasks'))
        fill_optional_fields = bool(options.get('fillOptionalFields'))
        title_block = user_title if user_title else '- (nicht separat angegeben)'
        description_block = user_description if user_description else '- (nicht separat angegeben)'
        return (
            'Du bist ein zweisprachiger IT-Projektassistent (Deutsch/Englisch) fuer die operative Aufgabenplanung. '
            'Nutze Meeting-Notizen sowie Titel und Beschreibung aus der Eingabe, um Aufgaben, Unteraufgaben und eigenstaendige Termine zu erkennen und getrennt aufzubereiten.\\n\\n'
            'Projekt: ' + project_title + '\\n'
            'Vorgaben aus der UI:\\n'
            '- Terminart (Task-Schedule): ' + schedule_mode + '\\n'
            '- Termin-Typ (Kalender): ' + event_type + '\\n'
            '- Unteraufgaben erzeugen: ' + ('ja' if create_subtasks else 'nein') + '\\n\\n'
            '- Mehrere Aufgaben aufteilen: ' + ('ja' if split_multi else 'nein') + '\\n\\n'
            '- Planungsstil: ' + (planning_style or 'standard') + '\\n'
            '- Aufwand aus Teilaufgaben abschaetzen: ' + ('ja' if estimate_from_subtasks else 'nein') + '\\n'
            '- Optionale Felder nutzen (labels/schedule/note): ' + ('ja' if fill_optional_fields else 'nein') + '\\n\\n'
            'Meeting-Notizen:\\n' + meeting_notes_markdown + '\\n\\n'
            'Titel (separat):\\n' + title_block + '\\n\\n'
            'Beschreibung (separat):\\n' + description_block + '\\n\\n'
            'Benutzereingabe:\\n' + user_input + '\\n\\n'
            'Bestehende Projektdaten (JSON):\\n' + json.dumps(existing_data, ensure_ascii=False, indent=2) + '\\n\\n'
            'Wichtig:\\n'
            '- Formuliere praezise, klar und fuer IT-Mitarbeiter verstaendlich.\\n'
            '- Liefere Titel und Beschreibung immer in Deutsch UND Englisch.\\n'
            '- Nutze realistische Werte fuer Prioritaet, Dringlichkeit, Aufwand und Labels.\\n'
            '- Erzeuge in title/description konkrete Entwicklungsarbeit (z. B. API, UI, Tests, Review, Release-Vorbereitung), keine abstrakten Sammelbegriffe.\\n'
            '- Leite ueber die Teilaufgaben durch den Loesungsprozess (Analyse -> Design -> Implementierung -> Tests -> Review -> Dokumentation/Release), Reihenfolge klar erkennbar.\\n'
            '- Wenn Unteraufgaben deaktiviert sind, gib leere Listen fuer subtasksDe/subtasksEn zurueck.\\n'
            '- Wenn Unteraufgaben aktiv sind, liefere 3 bis 8 subtasksDe und 3 bis 8 subtasksEn (kurz, konkret, umsetzbar).\\n'
            '- Jede Teilaufgabe soll eine grobe Dauer enthalten (z. B. 0.5h, 1h, 2h). Nutze diese Dauern fuer die Aufwandsschaetzung.\\n'
            '- effortHours soll die plausible Summe der Teilaufgaben sein (gerundet), immer > 0.\\n'
            '- Wenn "Mehrere Aufgaben aufteilen" = ja und die Eingabe mehrere eigenstaendige Arbeitspakete enthaelt, fuelle taskSuggestions mit 2-8 Aufgaben.\\n'
            '- Nummeriere Hauptaufgabe und Vorschlaege mit sequenceIndex. Setze dependsOnPrevious=true fuer jede Folgeaufgabe, die inhaltlich auf der vorherigen aufbaut.\n'
            '- Wenn keine sinnvolle Aufteilung moeglich ist, liefere taskSuggestions als leeres Array.\\n'
            '- Unterscheide Aufgaben-Deadlines von eigenstaendigen Kalenderterminen. Aufgaben-Deadlines gehoeren in task.schedule; Meetings, Abnahmen und andere feste Termine in events.\\n'
            '- Erfasse jeden erkannten eigenstaendigen Termin als separates Element in events. Wenn kein Termin erkannt wird, liefere events als leeres Array.\\n'
            '- Ordne Zeitraum und Aufwand plausibel ein: effortHours > 0, schedule moeglichst nicht none (deadline/fixed/range/asap), wenn zeitlich ableitbar.\\n'
            '- Optionale Felder labels, schedule und note duerfen und sollen befuellt werden, wenn aus Kontext sinnvoll ableitbar.\\n'
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
            '  "events": [\\n'
            '    {"create":true,"title":"...","description":"...","type":"meeting","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM"}\\n'
            '  ]\n'
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
            'events': [],
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
        events = payload.get('events') if isinstance(payload.get('events'), list) else []
        if not events and event:
            events = [event]
        schedule = task.get('schedule') if isinstance(task.get('schedule'), dict) else {}

        normalized_events = []
        for item in events[:12]:
            if not isinstance(item, dict):
                continue
            normalized_event = {
                'create': bool(item.get('create', True)),
                'title': str(item.get('title') or '').strip(),
                'description': str(item.get('description') or '').strip(),
                'type': self._normalize_event_type(str(item.get('type') or fallback_event_type)),
                'date': self._normalize_date_value(item.get('date')),
                'startTime': self._normalize_time_value(item.get('startTime')),
                'endTime': self._normalize_time_value(item.get('endTime'))
            }
            if normalized_event['title'] or normalized_event['date']:
                normalized_events.append(normalized_event)

        primary_event = normalized_events[0] if normalized_events else fallback['event']

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
            'events': normalized_events,
            'event': primary_event
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

        _atomic_write_text(full_path, document)

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
            schedule = item.get('schedule') if isinstance(item.get('schedule'), dict) else {}
            normalized_subtasks = []
            for sub in item.get('subtasks') if isinstance(item.get('subtasks'), list) else []:
                if isinstance(sub, str):
                    text = sub.strip()
                elif isinstance(sub, dict):
                    text = str(sub.get('title') or sub.get('text') or '').strip()
                else:
                    text = ''
                if text:
                    normalized_subtasks.append(text)

            dependency_task_id = str(item.get('dependencyTaskId') or item.get('externalDependencyTaskId') or '').strip()
            if not normalized_subtasks:
                normalized_subtasks = self._build_default_subtasks(title, str(item.get('description') or ''))
            normalized_tasks.append({
                'title': title,
                'description': str(item.get('description') or '').strip(),
                'status': str(item.get('status') or 'todo').strip(),
                'priority': str(item.get('priority') or 'medium').strip(),
                'urgency': self._normalize_urgency(item.get('urgency')),
                'effortHours': self._normalize_effort(item.get('effortHours')),
                'labels': item.get('labels') if isinstance(item.get('labels'), list) else [],
                'subtasks': normalized_subtasks,
                'sequenceIndex': self._normalize_sequence_index(item.get('sequenceIndex')),
                'dependsOnPrevious': bool(item.get('dependsOnPrevious')),
                'dependencyTaskId': dependency_task_id,
                'schedule': {
                    'mode': self._normalize_schedule_mode(schedule.get('mode')),
                    'deadline': self._normalize_date_value(schedule.get('deadline')),
                    'fixedAt': self._normalize_date_value(schedule.get('fixedAt')),
                    'rangeStart': self._normalize_date_value(schedule.get('rangeStart')),
                    'rangeEnd': self._normalize_date_value(schedule.get('rangeEnd'))
                },
                'note': str(item.get('note') or '').strip(),
                'assigneeId': str(item.get('assigneeId') or '').strip()
            })

        for idx, task in enumerate(normalized_tasks):
            if not task.get('sequenceIndex'):
                task['sequenceIndex'] = idx + 1
            if not task.get('subtasks'):
                task['subtasks'] = self._build_default_subtasks(task.get('title', ''), task.get('description', ''))

        if len(normalized_tasks) > 1:
            has_chain = any(bool(task.get('dependsOnPrevious')) for task in normalized_tasks)
            if not has_chain:
                for idx, task in enumerate(normalized_tasks):
                    task['dependsOnPrevious'] = idx > 0

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
        if not self._is_request_origin_allowed():
            self.send_response(403)
            self._apply_security_headers()
            self.end_headers()
            return

        self.send_response(204)
        self._apply_cors_headers()
        self._apply_security_headers()
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-GitHub-Token, X-Admin-Pin')
        self.send_header('Access-Control-Max-Age', '600')
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

    def _handle_github_e2e_workflow_post(self):
        payload, error = self._read_json_payload()
        if error:
            self._send_json({'error': error}, status=400)
            return
        owner = str(payload.get('owner') or '').strip()
        repo = str(payload.get('repo') or '').strip()
        branch = str(payload.get('branch') or 'main').strip()
        path = str(payload.get('path') or '.github/workflows/e2e.yml').strip().lstrip('/')
        content = str(payload.get('content') or '')
        token = self._read_github_token_header()
        if not owner or not repo or not token:
            self._send_json({'error': 'owner, repo und GitHub Token sind erforderlich.'}, status=400)
            return
        if not re.match(r'^[A-Za-z0-9_.-]+$', owner) or not re.match(r'^[A-Za-z0-9_.-]+$', repo):
            self._send_json({'error': 'Ungueltiger GitHub-Repositoryname.'}, status=400)
            return
        if not path.startswith('.github/workflows/') or '..' in path or not path.endswith(('.yml', '.yaml')):
            self._send_json({'error': 'Es duerfen nur YAML-Dateien unter .github/workflows/ angelegt werden.'}, status=400)
            return
        if not content.strip() or len(content.encode('utf-8')) > 256 * 1024:
            self._send_json({'error': 'Workflow-Inhalt fehlt oder ist zu gross.'}, status=400)
            return
        endpoint = GITHUB_API_BASE + '/repos/' + owner + '/' + repo + '/contents/' + '/'.join(quote(part, safe='') for part in path.split('/'))
        headers = {'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'projekt-dashboard-storage-server', 'Authorization': 'Bearer ' + token}
        request_body = {'message': str(payload.get('message') or 'chore: add automated E2E workflow'), 'content': base64.b64encode(content.encode('utf-8')).decode('ascii'), 'branch': branch}
        request = urllib.request.Request(endpoint, data=json.dumps(request_body).encode('utf-8'), method='PUT', headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode('utf-8') or '{}')
            dispatch_started = False
            if payload.get('dispatch') is True:
                dispatch_endpoint = GITHUB_API_BASE + '/repos/' + owner + '/' + repo + '/actions/workflows/' + quote(path, safe='/') + '/dispatches'
                dispatch_request = urllib.request.Request(dispatch_endpoint, data=json.dumps({'ref': branch}).encode('utf-8'), method='POST', headers=headers)
                try:
                    with urllib.request.urlopen(dispatch_request, timeout=30) as dispatch_response:
                        dispatch_started = dispatch_response.status in (200, 201, 204)
                except urllib.error.HTTPError:
                    dispatch_started = False
            self._send_json({'ok': True, 'path': path, 'commit': result.get('commit', {}), 'content': result.get('content', {}), 'dispatchStarted': dispatch_started})
        except urllib.error.HTTPError as exc:
            details = exc.read().decode('utf-8', errors='ignore')
            try:
                details = json.loads(details).get('message') or details
            except Exception:
                pass
            self._send_json({'error': 'GitHub Commit fehlgeschlagen: ' + str(details).strip()}, status=exc.code)
        except Exception as exc:
            self._send_json({'error': 'GitHub API nicht erreichbar: ' + str(exc)}, status=502)

    def _handle_routine_execute_post(self):
        if not ROUTINE_EXECUTION_ENABLED:
            self._send_json({'error': 'Serverausfuehrung ist aus Sicherheitsgruenden deaktiviert. Setze PROJECT_DASHBOARD_ROUTINE_EXECUTION=1 nach eigener Pruefung.'}, status=403)
            return
        payload, error = self._read_json_payload()
        if error:
            self._send_json({'error': error}, status=400)
            return
        runtime = str(payload.get('runtime') or '').strip().lower()
        script = str(payload.get('script') or '')
        if runtime not in ('bash', 'python') or not script.strip() or len(script.encode('utf-8')) > 128 * 1024:
            self._send_json({'error': 'Runtime muss bash oder python sein; Script fehlt oder ist zu gross.'}, status=400)
            return
        interpreter = '/usr/bin/python3' if runtime == 'python' else '/bin/bash'
        if not os.path.exists(interpreter):
            self._send_json({'error': 'Die Runtime ist auf dem Server nicht installiert.'}, status=400)
            return
        temporary_path = ''
        try:
            suffix = '.py' if runtime == 'python' else '.sh'
            descriptor, temporary_path = tempfile.mkstemp(prefix='projekt-routine-', suffix=suffix)
            with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
                handle.write(script)
            result = subprocess.run([interpreter, temporary_path], cwd=ROOT, capture_output=True, text=True, timeout=120, check=False)
            self._send_json({'ok': result.returncode == 0, 'exitCode': result.returncode, 'stdout': result.stdout[-12000:], 'stderr': result.stderr[-12000:]}, status=200 if result.returncode == 0 else 422)
        except subprocess.TimeoutExpired:
            self._send_json({'error': 'Routine nach 120 Sekunden abgebrochen.'}, status=408)
        except Exception as exc:
            self._send_json({'error': 'Routine konnte nicht ausgefuehrt werden: ' + str(exc)}, status=500)
        finally:
            if temporary_path:
                try:
                    os.unlink(temporary_path)
                except OSError:
                    pass

    def _proxy_github_json(self, endpoint, token=''):
        headers = {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'projekt-dashboard-storage-server'
        }
        if token:
            headers['Authorization'] = 'token ' + token

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

    def _request_origin(self):
        return str(self.headers.get('Origin', '') or '').strip().rstrip('/')

    def _is_allowed_origin(self, origin):
        if not origin:
            return True
        if origin in TRUSTED_ORIGINS:
            return True
        try:
            parsed = urlparse(origin)
            request_host = str(self.headers.get('Host', '') or '').strip().lower()
            return parsed.scheme in ('http', 'https') and parsed.netloc.lower() == request_host
        except Exception:
            return False

    def _is_request_origin_allowed(self):
        return self._is_allowed_origin(self._request_origin())

    def _is_pin_protected_path(self, path):
        if not path or not path.startswith('/api/'):
            return False
        return path != '/api/health'

    def _read_admin_pin_header(self):
        return str(self.headers.get('X-Admin-Pin', '') or '').strip()

    def _read_admin_pin_from_query(self, parsed):
        if not parsed:
            return ''
        params = parse_qs(parsed.query or '')
        return str((params.get('pin') or [''])[0] or '').strip()

    def _is_admin_pin_valid(self):
        candidate = self._read_admin_pin_header()
        if not ADMIN_PIN:
            return True
        return hmac.compare_digest(candidate, ADMIN_PIN)

    def _require_admin_pin_for_request(self, path, parsed=None):
        if not self._is_pin_protected_path(path):
            return True
        if self._is_admin_pin_valid():
            return True

        # EventSource cannot attach custom headers, therefore /api/kv/stream
        # additionally accepts the PIN via query string.
        if path == '/api/kv/stream' and ADMIN_PIN:
            query_pin = self._read_admin_pin_from_query(parsed)
            if query_pin and hmac.compare_digest(query_pin, ADMIN_PIN):
                return True

        self._send_json({'error': 'Admin PIN erforderlich oder ungueltig.', 'authRequired': True}, status=401)
        return False

    def _apply_cors_headers(self):
        origin = self._request_origin()
        if not origin:
            return
        if self._is_allowed_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')

    def _apply_security_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')

    def _read_all(self):
        conn = open_db_connection(DB_PATH)
        rows = conn.execute('SELECT key, value FROM kv_store ORDER BY key').fetchall()
        conn.close()
        return {key: value for key, value in rows}

    def _send_kv_value(self, parsed):
        params = parse_qs(parsed.query or '', keep_blank_values=True)
        key = str((params.get('key') or [''])[0] or '')
        if not key:
            self._send_json({'error': 'Missing key'}, status=400)
            return

        conn = open_db_connection(DB_PATH)
        try:
            row = conn.execute(
                'SELECT value, updatedAt FROM kv_store WHERE key = ?',
                (key,)
            ).fetchone()
        finally:
            conn.close()

        self._send_json({
            'key': key,
            'exists': row is not None,
            'value': row[0] if row is not None else None,
            'updatedAt': row[1] if row is not None else None
        })

    def _send_kv_snapshot(self):
        global KV_SNAPSHOT_METADATA

        accepts_gzip = 'gzip' in str(self.headers.get('Accept-Encoding', '') or '').lower()
        requested_etag = str(self.headers.get('If-None-Match', '') or '').strip()
        payload_file = None
        with KV_SNAPSHOT_LOCK:
            if KV_SNAPSHOT_METADATA is None:
                KV_SNAPSHOT_METADATA = self._build_kv_snapshot_files()
            snapshot = KV_SNAPSHOT_METADATA
            if requested_etag != snapshot['etag']:
                path = snapshot['gzipPath'] if accepts_gzip else snapshot['path']
                size = snapshot['gzipSize'] if accepts_gzip else snapshot['size']
                try:
                    payload_file = open(path, 'rb')
                except OSError:
                    KV_SNAPSHOT_METADATA = None

        if requested_etag == snapshot['etag']:
            self.send_response(304)
            self.send_header('ETag', snapshot['etag'])
            self.send_header('Cache-Control', 'no-cache')
            self._apply_cors_headers()
            self._apply_security_headers()
            self.end_headers()
            return

        if payload_file is None:
            self._send_json({'error': 'Snapshot konnte nicht geladen werden.'}, status=503)
            return

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('ETag', snapshot['etag'])
        self.send_header('Vary', 'Accept-Encoding, Origin')
        if accepts_gzip:
            self.send_header('Content-Encoding', 'gzip')
        self._apply_cors_headers()
        self._apply_security_headers()
        self.end_headers()
        try:
            while True:
                chunk = payload_file.read(KV_STREAM_CHUNK_SIZE)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            payload_file.close()

    def _build_kv_snapshot_files(self):
        directory = os.path.dirname(KV_SNAPSHOT_PATH)
        os.makedirs(directory, exist_ok=True)
        raw_descriptor, raw_temp_path = tempfile.mkstemp(prefix='.kv-snapshot.', suffix='.json.tmp', dir=directory)
        gzip_descriptor, gzip_temp_path = tempfile.mkstemp(prefix='.kv-snapshot.', suffix='.json.gz.tmp', dir=directory)
        conn = None

        try:
            conn = open_db_connection(DB_PATH)
            cursor = conn.execute('SELECT key, value FROM kv_store ORDER BY key')
            with os.fdopen(raw_descriptor, 'wb') as raw_file, os.fdopen(gzip_descriptor, 'wb') as gzip_file:
                with gzip.GzipFile(fileobj=gzip_file, mode='wb', compresslevel=5, mtime=0) as compressed_file:
                    first = True
                    opening = b'{'
                    raw_file.write(opening)
                    compressed_file.write(opening)
                    for key, value in cursor:
                        prefix = b'' if first else b','
                        entry = prefix + json.dumps(str(key), ensure_ascii=False).encode('utf-8') + b':' + json.dumps(str(value), ensure_ascii=False).encode('utf-8')
                        raw_file.write(entry)
                        compressed_file.write(entry)
                        first = False
                    closing = b'}'
                    raw_file.write(closing)
                    compressed_file.write(closing)
                raw_file.flush()
                gzip_file.flush()
                os.fsync(raw_file.fileno())
                os.fsync(gzip_file.fileno())

            os.replace(raw_temp_path, KV_SNAPSHOT_PATH)
            os.replace(gzip_temp_path, KV_SNAPSHOT_GZIP_PATH)
            _fsync_directory(directory)
            return {
                'path': KV_SNAPSHOT_PATH,
                'gzipPath': KV_SNAPSHOT_GZIP_PATH,
                'size': os.path.getsize(KV_SNAPSHOT_PATH),
                'gzipSize': os.path.getsize(KV_SNAPSHOT_GZIP_PATH),
                'etag': '"kv-' + str(KV_SNAPSHOT_REVISION) + '-' + uuid.uuid4().hex + '"'
            }
        except Exception:
            for temp_path in (raw_temp_path, gzip_temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
            raise
        finally:
            if conn is not None:
                conn.close()

    def _invalidate_kv_snapshot(self):
        global KV_SNAPSHOT_METADATA, KV_SNAPSHOT_REVISION
        with KV_SNAPSHOT_LOCK:
            KV_SNAPSHOT_REVISION += 1
            KV_SNAPSHOT_METADATA = None

    def _write_value(self, key, value):
        with STORAGE_LOCK:
            conn = open_db_connection(DB_PATH)
            try:
                if value is None:
                    conn.execute('DELETE FROM kv_store WHERE key = ?', (key,))
                else:
                    conn.execute(
                        'INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)',
                        (key, str(value), utc_now_iso_z())
                    )
                _commit_durably(conn)
            finally:
                conn.close()
        self._invalidate_kv_snapshot()
        schedule_full_backup()

    def _clear_all_values(self):
        with STORAGE_LOCK:
            conn = open_db_connection(DB_PATH)
            try:
                conn.execute('DELETE FROM kv_store')
                _commit_durably(conn)
            finally:
                conn.close()
        self._invalidate_kv_snapshot()
        schedule_full_backup()

    def _send_json(self, data, status=200):
        payload = json.dumps(data).encode('utf-8')
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self._apply_cors_headers()
            self._apply_security_headers()
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
        if full_path.endswith(('.html', '.js', '.css')):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        self._apply_security_headers()
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


class DashboardHTTPServer(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError, OSError)):
            return
        super().handle_error(request, client_address)


if __name__ == '__main__':
    init_db()
    httpd = DashboardHTTPServer((HOST, PORT), StorageHandler)
    print(f'Storage server listening on http://{HOST}:{PORT}')
    httpd.serve_forever()
