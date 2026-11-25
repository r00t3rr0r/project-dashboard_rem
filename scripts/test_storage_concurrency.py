import json
import hashlib
import http.client
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import storage_server as storage


class GitHubCommitQueryTest(unittest.TestCase):
    def test_commit_query_time_filters_and_existing_defaults(self):
        handler = object.__new__(storage.StorageHandler)
        handler.headers = {'X-GitHub-Token': 'test-token'}
        queries = [
            ('owner=acme&repo=app', {'per_page': ['100'], 'page': ['1']}),
            ('owner=acme&repo=app&page=2&per_page=50&since=2026-11-16T12%3A00%3A00Z&until=2026-11-17T12%3A00%3A00Z',
             {'per_page': ['50'], 'page': ['2'], 'since': ['2026-11-16T12:00:00Z'], 'until': ['2026-11-17T12:00:00Z']}),
        ]
        for query, expected in queries:
            with self.subTest(query=query), mock.patch.object(handler, '_proxy_github_json') as proxy:
                handler._handle_github_commits_get(urllib.parse.urlparse('/api/github/commits?' + query))
                endpoint, token = proxy.call_args.args
                self.assertEqual(urllib.parse.urlparse(endpoint).path, '/repos/acme/app/commits')
                self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlparse(endpoint).query), expected)
                self.assertEqual(token, 'test-token')

    def test_missing_repository_rejected(self):
        handler = object.__new__(storage.StorageHandler)
        with mock.patch.object(handler, '_send_json') as send:
            handler._handle_github_commits_get(urllib.parse.urlparse('/api/github/commits?owner=acme'))
            self.assertEqual(send.call_args.kwargs['status'], 400)

    def test_project_knowledge_ollama_rejects_truncated_or_interrupted_streams(self):
        handler = object.__new__(storage.StorageHandler)
        for pieces in ([{'response': 'Teil', 'done': True, 'done_reason': 'length'}],
                       [{'response': 'Teil'}]):
            response = mock.MagicMock()
            response.__enter__.return_value = response
            response.__iter__.return_value = iter((json.dumps(piece) + '\n').encode() for piece in pieces)
            with self.subTest(pieces=pieces), mock.patch.object(storage, 'OLLAMA_BASE_URLS', ['http://localhost:11434']), \
                    mock.patch.object(storage.urllib.request, 'urlopen', return_value=response) as urlopen:
                with self.assertRaises(RuntimeError):
                    handler._call_ollama('model', 'prompt', require_complete=True)
                self.assertFalse(json.loads(urlopen.call_args.args[0].data)['truncate'])
                self.assertEqual(json.loads(urlopen.call_args.args[0].data)['options']['num_ctx'], 8192)


class StorageConcurrencyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        data_dir = cls.temp_dir.name
        storage.DB_PATH = os.path.join(data_dir, 'test.sqlite')
        storage.BACKUP_PATH = os.path.join(data_dir, 'backup.sqlite')
        storage.BACKUP_JSON_PATH = os.path.join(data_dir, 'backup.json')
        storage.BACKUP_STAMP_PATH = os.path.join(data_dir, 'backup.stamp')
        storage.KV_SNAPSHOT_PATH = os.path.join(data_dir, 'snapshot.json')
        storage.KV_SNAPSHOT_GZIP_PATH = storage.KV_SNAPSHOT_PATH + '.gz'
        storage.TASK_ATTACHMENT_DIR = os.path.join(data_dir, 'task-attachments')
        storage.KV_SNAPSHOT_METADATA = None
        storage.KV_SNAPSHOT_REVISION = 0
        storage.BACKUP_DELAY_SECONDS = 60
        storage.AUTH_ATTEMPTS.clear()

        connection = storage.open_db_connection(storage.DB_PATH)
        connection.execute(
            'CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL)'
        )
        connection.execute('INSERT INTO kv_store VALUES (?, ?, ?)', ('pd_employees', json.dumps([{
            'id': 'test-admin', 'auth': {'accessLevel': 'admin', 'login': {
                'enabled': True, 'username': 'test.admin',
                'passwordHash': hashlib.sha256(b'test-password').hexdigest()
            }}
        }]), storage.utc_now_iso_z()))
        connection.commit()
        connection.close()

        cls.server = storage.DashboardHTTPServer(('127.0.0.1', 0), storage.StorageHandler)
        cls.base_url = 'http://127.0.0.1:' + str(cls.server.server_address[1])
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.cookie = cls.login_cookie(False)

    @classmethod
    def login_cookie(cls, remember):
        request = urllib.request.Request(cls.base_url + '/api/auth/login', data=json.dumps({
            'username': 'test.admin', 'password': 'test-password', 'remember': remember
        }).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.headers['Set-Cookie']

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join(timeout=3)
        with storage.BACKUP_SCHEDULE_LOCK:
            if storage.BACKUP_TIMER is not None:
                storage.BACKUP_TIMER.cancel()
                storage.BACKUP_TIMER = None
        cls.temp_dir.cleanup()

    @classmethod
    def request_json(cls, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(
            cls.base_url + path,
            data=body,
            method=method,
            headers={
                'Content-Type': 'application/json',
                'Cookie': cls.cookie.split(';')[0]
            }
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode('utf-8'))

    def test_authentication_required_and_pin_removed(self):
        for path in ('/api/kv', '/api/kv/stream?pin=1337', '/api/auth/session',
                     '/api/hosting/checks', '/api/hosting/screenshot?projectId=p1',
                     '/api/ai/project-knowledge?projectId=p1'):
            request = urllib.request.Request(self.base_url + path, headers={'X-Admin-Pin': '1337'})
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=10)
            self.assertEqual(caught.exception.code, 401)

    def test_project_knowledge_link_reads_only_the_project_file(self):
        project = {'id': 'knowledge-test', 'aiKnowledge': {'filePath': 'data/project-knowledge/test.md'}}
        conn = storage.open_db_connection()
        old = conn.execute('SELECT value, updatedAt FROM kv_store WHERE key = ?', ('pd_projects',)).fetchone()
        conn.execute('INSERT OR REPLACE INTO kv_store VALUES (?, ?, ?)',
                     ('pd_projects', json.dumps([project]), storage.utc_now_iso_z()))
        conn.commit()
        conn.close()
        try:
            with tempfile.TemporaryDirectory() as directory, mock.patch.object(storage, 'KNOWLEDGE_DIR', directory):
                with open(os.path.join(directory, 'test.md'), 'w', encoding='utf-8') as output:
                    output.write('# Projektwissen')
                request = urllib.request.Request(self.base_url + '/api/ai/project-knowledge?projectId=knowledge-test',
                                                 headers={'Cookie': self.cookie.split(';')[0]})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.read().decode('utf-8'), '# Projektwissen')
                    self.assertEqual(response.headers.get_content_type(), 'text/plain')
                project['aiKnowledge']['filePath'] = 'data/project-knowledge/../test.md'
                conn = storage.open_db_connection()
                conn.execute('UPDATE kv_store SET value = ? WHERE key = ?', (json.dumps([project]), 'pd_projects'))
                conn.commit()
                conn.close()
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request)
                self.assertEqual(caught.exception.code, 404)
        finally:
            conn = storage.open_db_connection()
            if old:
                conn.execute('UPDATE kv_store SET value = ?, updatedAt = ? WHERE key = ?', (*old, 'pd_projects'))
            else:
                conn.execute('DELETE FROM kv_store WHERE key = ?', ('pd_projects',))
            conn.commit()
            conn.close()

    def test_project_knowledge_save_validates_and_persists_markdown(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(storage, 'KNOWLEDGE_DIR', directory):
            status, result = self.request_json('POST', '/api/project-knowledge', {
                'projectId': 'p1', 'projectTitle': 'Demo', 'markdown': '# Wissen\n\nInhalt'
            })
            self.assertEqual(status, 200)
            self.assertEqual(result['filePath'], 'data/project-knowledge/p1-Demo-ki-wissen.md')
            with open(os.path.join(directory, 'p1-Demo-ki-wissen.md'), encoding='utf-8') as saved:
                self.assertEqual(saved.read(), '# Wissen\n\nInhalt')
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request_json('POST', '/api/project-knowledge', {
                    'projectId': 'p1', 'projectTitle': 'Demo', 'markdown': ' '
                })
            self.assertEqual(caught.exception.code, 400)

    def test_project_knowledge_analysis_only_returns_markdown_without_writing(self):
        with mock.patch.object(storage.StorageHandler, '_call_ollama', return_value=('# Analyse', ['# Analyse'])) as call:
            status, result = self.request_json('POST', '/api/ai/project-knowledge', {
                'projectId': 'p1', 'projectTitle': 'Demo', 'model': 'test-model',
                'analysisOnly': True, 'knowledgePrompt': 'Analysiere diesen Abschnitt'
            })
        self.assertEqual(status, 200)
        self.assertEqual(result['markdown'], '# Analyse')
        self.assertNotIn('filePath', result)
        self.assertEqual(call.call_args.args, ('test-model', 'Analysiere diesen Abschnitt'))
        self.assertTrue(call.call_args.kwargs['require_complete'])
        self.assertEqual(call.call_args.kwargs['max_tokens'], 4096)

    def test_project_knowledge_rejects_context_overflow_before_generation(self):
        with mock.patch.object(storage.StorageHandler, '_call_ollama') as call:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request_json('POST', '/api/ai/project-knowledge', {
                    'projectId': 'p1', 'projectTitle': 'Demo', 'analysisOnly': True,
                    'knowledgePrompt': '漢' * 1100, 'promptConfig': {'maxTokens': 4096}
                })
            self.assertEqual(json.loads(caught.exception.read())['code'], 'AI_CONTEXT_LIMIT')
            call.assert_not_called()

    def test_project_knowledge_returns_retryable_truncation_code(self):
        with mock.patch.object(storage.StorageHandler, '_call_ollama', side_effect=RuntimeError('Antwort abgeschnitten')):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request_json('POST', '/api/ai/project-knowledge', {
                    'projectId': 'p1', 'projectTitle': 'Demo', 'analysisOnly': True, 'knowledgePrompt': 'Chunk'
                })
            self.assertEqual(json.loads(caught.exception.read())['code'], 'AI_OUTPUT_TRUNCATED')

    def test_hosting_checks_endpoint_is_available_to_a_session(self):
        status, payload = self.request_json('GET', '/api/hosting/checks')
        self.assertEqual(status, 200)
        self.assertIsInstance(payload['checks'], dict)

    def test_screenshot_is_saved_for_the_current_project_url(self):
        project = {'id': 'screenshot-test', 'hosting': {'url': 'https://example.com/'}}
        conn = storage.open_db_connection()
        old = conn.execute('SELECT value, updatedAt FROM kv_store WHERE key = ?', ('pd_projects',)).fetchone()
        conn.execute('INSERT OR REPLACE INTO kv_store VALUES (?, ?, ?)',
                     ('pd_projects', json.dumps([project]), storage.utc_now_iso_z()))
        conn.commit()
        conn.close()
        image = b'\x89PNG\r\n\x1a\nfixture'
        try:
            with mock.patch.object(storage.screenshot_capture, 'capture', return_value=image) as capture:
                status, result = self.request_json('POST', '/api/hosting/screenshot', {'projectId': 'screenshot-test'})
            self.assertEqual(status, 200)
            self.assertIn('createdAt', result)
            capture.assert_called_once_with('https://example.com/')
            status, metadata = self.request_json('GET', '/api/hosting/screenshot?meta=1&projectId=screenshot-test')
            self.assertEqual(metadata['createdAt'], result['createdAt'])
            request = urllib.request.Request(self.base_url + '/api/hosting/screenshot?projectId=screenshot-test',
                                             headers={'Cookie': self.cookie.split(';')[0]})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.headers.get_content_type(), 'image/png')
                self.assertEqual(response.read(), image)
            project['hosting']['url'] = 'https://changed.example/'
            conn = storage.open_db_connection()
            conn.execute('UPDATE kv_store SET value = ? WHERE key = ?', (json.dumps([project]), 'pd_projects'))
            conn.commit()
            conn.close()
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request)
            self.assertEqual(caught.exception.code, 404)
        finally:
            conn = storage.open_db_connection()
            if old:
                conn.execute('UPDATE kv_store SET value = ?, updatedAt = ? WHERE key = ?', (*old, 'pd_projects'))
            else:
                conn.execute('DELETE FROM kv_store WHERE key = ?', ('pd_projects',))
            conn.execute('DELETE FROM hosting_screenshots WHERE project_id = ?', ('screenshot-test',))
            conn.commit()
            conn.close()

    def test_update_progress_requires_admin_session(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.base_url + '/api/system/update/progress', timeout=10)
        self.assertEqual(caught.exception.code, 401)
        status, progress = self.request_json('GET', '/api/system/update/progress')
        self.assertEqual(status, 200)
        self.assertIn(progress['status'], ('idle', 'running', 'restarting', 'complete', 'error'))
        self.assertIsInstance(progress['logs'], list)

    def test_update_progress_is_available_while_update_request_is_running(self):
        started = threading.Event()
        release = threading.Event()
        responses = []

        def delayed_update():
            storage._update_progress('running', 55, 'Datenbank-Backup erstellen.')
            started.set()
            if not release.wait(10):
                raise RuntimeError('Test-Update nicht freigegeben')
            return {'ok': True, 'message': 'Test abgeschlossen.'}, False

        def submit():
            request = urllib.request.Request(
                self.base_url + '/api/system/update/apply', data=b'', method='POST',
                headers={'Cookie': self.cookie.split(';')[0], 'X-Update-Run-Id': 'test-run'}
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                responses.append(json.load(response))

        with mock.patch.object(storage, 'UPDATE_PROGRESS', {'runId': '', 'status': 'idle', 'percent': 0, 'logs': []}), \
             mock.patch.object(storage, 'apply_update', side_effect=delayed_update), \
             mock.patch.object(storage, 'get_version_info', return_value={}):
            worker = threading.Thread(target=submit)
            worker.start()
            try:
                self.assertTrue(started.wait(10))
                status, progress = self.request_json('GET', '/api/system/update/progress')
                self.assertEqual(status, 200)
                self.assertEqual(progress['runId'], 'test-run')
                self.assertEqual(progress['percent'], 55)
                self.assertIn('Datenbank-Backup', progress['logs'][-1])
            finally:
                release.set()
                worker.join(15)
        self.assertFalse(worker.is_alive())
        self.assertTrue(responses[0]['update']['ok'])

    def test_task_attachment_upload_and_download(self):
        content = b'\x00\xfftask attachment\n'
        unauthenticated = urllib.request.Request(self.base_url + '/api/task-attachments', data=content, method='POST')
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(unauthenticated, timeout=10)
        self.assertEqual(caught.exception.code, 401)
        request = urllib.request.Request(
            self.base_url + '/api/task-attachments', data=content, method='POST',
            headers={'Content-Type': 'application/octet-stream', 'Cookie': self.cookie.split(';')[0]}
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            attachment = json.load(response)
        self.assertTrue(attachment['url'].startswith('/api/task-attachments/'))
        download = urllib.request.Request(self.base_url + attachment['url'], headers={'Cookie': self.cookie.split(';')[0]})
        with urllib.request.urlopen(download, timeout=10) as response:
            self.assertEqual(response.read(), content)
            self.assertEqual(response.headers['Content-Type'], 'application/octet-stream')
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.base_url + attachment['url'], timeout=10)
        self.assertEqual(caught.exception.code, 401)
        invalid = urllib.request.Request(self.base_url + '/api/task-attachments/not-an-id', headers={'Cookie': self.cookie.split(';')[0]})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(invalid, timeout=10)
        self.assertEqual(caught.exception.code, 404)

        empty = urllib.request.Request(self.base_url + '/api/task-attachments', data=b'', method='POST', headers={'Cookie': self.cookie.split(';')[0]})
        with urllib.request.urlopen(empty, timeout=10) as response:
            empty_attachment = json.load(response)
        empty_download = urllib.request.Request(self.base_url + empty_attachment['url'], headers={'Cookie': self.cookie.split(';')[0]})
        with urllib.request.urlopen(empty_download, timeout=10) as response:
            self.assertEqual(response.read(), b'')

    def test_task_attachment_larger_than_previous_limit(self):
        chunk = b'x' * (1024 * 1024)
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=60)
        connection.putrequest('POST', '/api/task-attachments')
        connection.putheader('Cookie', self.cookie.split(';')[0])
        connection.putheader('Content-Type', 'application/octet-stream')
        connection.putheader('Content-Length', str(100 * len(chunk) + 1))
        connection.endheaders()
        for _ in range(100):
            connection.send(chunk)
        connection.send(b'y')
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        attachment = json.load(response)
        connection.close()
        path = os.path.join(storage.TASK_ATTACHMENT_DIR, attachment['url'].rsplit('/', 1)[-1])
        self.assertEqual(os.path.getsize(path), 100 * len(chunk) + 1)
        with open(path, 'rb') as uploaded:
            self.assertEqual(uploaded.read(1), b'x')
            uploaded.seek(-1, os.SEEK_END)
            self.assertEqual(uploaded.read(), b'y')

    def test_login_dropdown_only_exposes_names_and_usernames(self):
        with urllib.request.urlopen(self.base_url + '/api/auth/users', timeout=10) as response:
            payload = json.load(response)
        self.assertEqual(payload, {'users': [{'name': 'test.admin', 'username': 'test.admin'}]})

    def test_expired_session_is_rejected(self):
        cookie = self.login_cookie(True).split(';')[0]
        token = hashlib.sha256(cookie.split('=', 1)[1].encode()).hexdigest()
        with storage.open_db_connection() as connection:
            connection.execute('UPDATE auth_sessions SET expires = 0 WHERE token = ?', (token,))
        request = urllib.request.Request(self.base_url + '/api/auth/session', headers={'Cookie': cookie})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(caught.exception.code, 401)

    def test_session_remember_restore_and_logout(self):
        remembered = self.login_cookie(True)
        self.assertIn('Max-Age=2592000', remembered)
        self.assertIn('HttpOnly', remembered)
        self.assertIn('SameSite=Lax', remembered)
        self.assertNotIn('Max-Age', self.cookie)
        headers = {'Cookie': remembered.split(';')[0]}
        request = urllib.request.Request(self.base_url + '/api/auth/session', headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(json.load(response)['employeeId'], 'test-admin')
        request = urllib.request.Request(self.base_url + '/api/auth/logout', data=b'{}', headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertIn('Max-Age=0', response.headers['Set-Cookie'])
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(urllib.request.Request(self.base_url + '/api/kv', headers=headers), timeout=10)
        self.assertEqual(caught.exception.code, 401)

    def test_wrong_password_and_origin_are_rejected(self):
        for headers, expected in (({}, 401), ({'Origin': 'http://untrusted.invalid'}, 403)):
            request = urllib.request.Request(self.base_url + '/api/auth/login', data=json.dumps({
                'username': 'test.admin', 'password': 'wrong'
            }).encode(), headers={'Content-Type': 'application/json', **headers})
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=10)
            self.assertEqual(caught.exception.code, expected)

    def test_private_files_are_not_served(self):
        for path in ('/data/projekt-dashboard.backup.json', '/.git/config', '/storage_server.py'):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.base_url + path, timeout=10)
            self.assertEqual(caught.exception.code, 403)

    def test_supported_password_formats(self):
        handler = object.__new__(storage.StorageHandler)
        password = 'test-password'
        sha = hashlib.sha256(password.encode()).hexdigest()
        derived = hashlib.pbkdf2_hmac('sha256', password.encode(), b'salt', 10000).hex()
        for stored in (sha, 'compat$fallback:0$' + sha, 'pbkdf2$10000$73616c74$' + derived):
            self.assertTrue(handler._verify_login_password(password, stored))
            self.assertFalse(handler._verify_login_password('wrong', stored))

    def test_parallel_writes_and_targeted_reads(self):
        entries = {'load-test-' + str(index): 'value-' + str(index) for index in range(24)}

        with ThreadPoolExecutor(max_workers=12) as executor:
            write_results = list(executor.map(
                lambda item: self.request_json('POST', '/api/kv', {'key': item[0], 'value': item[1]}),
                entries.items()
            ))
        self.assertTrue(all(status == 200 for status, _payload in write_results))

        def read_entry(item):
            key, expected_value = item
            path = '/api/kv?key=' + urllib.parse.quote(key, safe='')
            status, payload = self.request_json('GET', path)
            return status, payload, expected_value

        with ThreadPoolExecutor(max_workers=12) as executor:
            read_results = list(executor.map(read_entry, entries.items()))

        for status, payload, expected_value in read_results:
            self.assertEqual(status, 200)
            self.assertTrue(payload['exists'])
            self.assertEqual(payload['value'], expected_value)

        status, snapshot = self.request_json('GET', '/api/kv')
        self.assertEqual(status, 200)
        self.assertEqual({key: snapshot[key] for key in entries}, entries)

    def test_targeted_read_reports_deleted_key(self):
        key = 'deleted-key'
        self.request_json('POST', '/api/kv', {'key': key, 'value': 'temporary'})
        self.request_json('POST', '/api/kv', {'key': key, 'value': None})

        status, payload = self.request_json('GET', '/api/kv?key=' + key)
        self.assertEqual(status, 200)
        self.assertFalse(payload['exists'])
        self.assertIsNone(payload['value'])

    def test_health_request_does_not_wait_for_running_backup(self):
        storage.BACKUP_RUN_LOCK.acquire()
        try:
            status, payload = self.request_json('GET', '/api/health')
        finally:
            storage.BACKUP_RUN_LOCK.release()

        self.assertEqual(status, 200)
        self.assertEqual(payload['status'], 'ok')


if __name__ == '__main__':
    unittest.main()