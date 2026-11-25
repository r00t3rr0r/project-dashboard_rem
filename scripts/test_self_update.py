import os
from contextlib import closing, nullcontext
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import storage_server as storage


class SelfUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.remote = base / 'remote'
        self.remote.mkdir()
        self.git(self.remote, 'init', '-b', 'main')
        self.git(self.remote, 'config', 'user.name', 'Test')
        self.git(self.remote, 'config', 'user.email', 'test@example.invalid')
        self.commit('print("original")\n')
        self.checkout = base / 'checkout'
        self.git(base, 'clone', str(self.remote), str(self.checkout))
        self.git(self.checkout, 'config', 'user.name', 'Test')
        self.git(self.checkout, 'config', 'user.email', 'test@example.invalid')
        data = self.checkout / 'data'
        data.mkdir()
        db = data / 'db.sqlite'
        with closing(sqlite3.connect(db)) as connection, connection:
            connection.execute('CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT, updatedAt TEXT)')
            connection.execute('INSERT INTO kv_store VALUES (?, ?, ?)', ('test', 'value', 'now'))
        self.patch = mock.patch.multiple(
            storage, ROOT=str(self.checkout), DB_PATH=str(db),
            BACKUP_PATH=str(data / 'backup.sqlite'),
            BACKUP_JSON_PATH=str(data / 'backup.json'),
            BACKUP_STAMP_PATH=str(data / 'backup.stamp'),
            UPDATE_REMOTE='origin', UPDATE_BRANCH='main',
            UPDATE_STATE={'lastCheck': None, 'lastUpdate': None},
            UPDATE_PROGRESS={'runId': '', 'status': 'idle', 'percent': 0, 'logs': []},
        )
        self.patch.start()
        self.addCleanup(self.patch.stop)

    @staticmethod
    def git(directory, *args):
        return subprocess.run(['git', '-C', str(directory), *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, source):
        (self.remote / 'storage_server.py').write_text(source)
        self.git(self.remote, 'add', 'storage_server.py')
        self.git(self.remote, 'commit', '-m',
                 'Test update\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>')

    def test_update_creates_real_backup_and_fast_forwards(self):
        self.commit('print("updated")\n')
        check = storage.check_for_update()
        self.assertEqual(check['behind'], 1)
        result, restart = storage.apply_update()
        self.assertTrue(result['ok'])
        self.assertTrue(restart)
        self.assertEqual(result['to'], self.git(self.remote, 'rev-parse', '--short=7', 'HEAD'))
        self.assertEqual(self.git(self.checkout, 'rev-parse', 'HEAD'), check['remoteCommit'])
        with closing(sqlite3.connect(storage.BACKUP_PATH)) as connection:
            self.assertEqual(connection.execute('SELECT value FROM kv_store WHERE key = ?', ('test',)).fetchone()[0], 'value')
        self.assertTrue(Path(storage.BACKUP_JSON_PATH).exists())
        self.assertTrue(Path(storage.DB_PATH).exists())

    def test_invalid_syntax_does_not_change_checkout_or_create_backup(self):
        original = self.git(self.checkout, 'rev-parse', 'HEAD')
        self.commit('def broken(:\n')
        result, restart = storage.apply_update()
        self.assertFalse(result['ok'])
        self.assertFalse(restart)
        self.assertIn('Syntaxpruefung', result['message'])
        self.assertEqual(self.git(self.checkout, 'rev-parse', 'HEAD'), original)
        self.assertFalse(Path(storage.BACKUP_PATH).exists())

    def test_backup_failure_prevents_update(self):
        original = self.git(self.checkout, 'rev-parse', 'HEAD')
        self.commit('print("updated")\n')
        with mock.patch.object(storage, 'ensure_daily_backup', return_value=False):
            result, restart = storage.apply_update()
        self.assertFalse(result['ok'])
        self.assertFalse(restart)
        self.assertIn('Backup', result['message'])
        self.assertEqual(self.git(self.checkout, 'rev-parse', 'HEAD'), original)
        progress = storage._update_progress_snapshot()
        self.assertEqual(progress['status'], 'error')
        self.assertLess(progress['percent'], 100)
        self.assertIn('Backup', progress['logs'][-1])

    def test_progress_reports_live_steps_and_merge_output(self):
        self.commit('print("updated")\n')
        backup_started = threading.Event()
        release_backup = threading.Event()
        real_backup = storage.ensure_daily_backup
        outcome = []

        def delayed_backup(force=False):
            backup_started.set()
            if not release_backup.wait(10):
                raise RuntimeError('Test-Backup nicht freigegeben')
            return real_backup(force=force)

        storage._update_progress('running', 0, 'Update wird gestartet.', 'run-test')
        with mock.patch.object(storage, 'ensure_daily_backup', side_effect=delayed_backup):
            worker = threading.Thread(target=lambda: outcome.append(storage.apply_update()))
            worker.start()
            try:
                self.assertTrue(backup_started.wait(10))
                progress = storage._update_progress_snapshot()
                self.assertEqual(progress['runId'], 'run-test')
                self.assertEqual(progress['status'], 'running')
                self.assertEqual(progress['percent'], 55)
                self.assertIn('Datenbank-Backup', progress['logs'][-1])
            finally:
                release_backup.set()
                worker.join(10)
        self.assertFalse(worker.is_alive())
        self.assertTrue(outcome[0][0]['ok'])
        progress = storage._update_progress_snapshot()
        self.assertEqual(progress['status'], 'restarting')
        self.assertEqual(progress['percent'], 90)
        self.assertTrue(any('Fast-forward' in line for line in progress['logs']))

    def test_local_changes_are_not_overwritten(self):
        original = self.git(self.checkout, 'rev-parse', 'HEAD')
        self.commit('print("updated")\n')
        (self.checkout / 'storage_server.py').write_text('local change\n')
        result, restart = storage.apply_update()
        self.assertFalse(result['ok'])
        self.assertFalse(restart)
        self.assertIn('Lokale Aenderungen', result['message'])
        self.assertEqual((self.checkout / 'storage_server.py').read_text(), 'local change\n')
        self.assertEqual(self.git(self.checkout, 'rev-parse', 'HEAD'), original)

    def test_untracked_collision_is_not_overwritten(self):
        original = self.git(self.checkout, 'rev-parse', 'HEAD')
        (self.remote / 'new_file.txt').write_text('upstream\n')
        self.git(self.remote, 'add', 'new_file.txt')
        self.git(self.remote, 'commit', '-m',
                 'Add file\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>')
        (self.checkout / 'new_file.txt').write_text('local\n')
        result, restart = storage.apply_update()
        self.assertFalse(result['ok'])
        self.assertFalse(restart)
        self.assertEqual((self.checkout / 'new_file.txt').read_text(), 'local\n')
        self.assertEqual(self.git(self.checkout, 'rev-parse', 'HEAD'), original)

    def test_local_commits_ahead_are_not_reported_as_up_to_date(self):
        (self.checkout / 'storage_server.py').write_text('print("local")\n')
        self.git(self.checkout, 'add', 'storage_server.py')
        self.git(self.checkout, 'commit', '-m',
                 'Local change\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>')
        check = storage.check_for_update()
        self.assertEqual(check['ahead'], 1)
        self.assertFalse(check['upToDate'])
        result, restart = storage.apply_update()
        self.assertFalse(result['ok'])
        self.assertFalse(restart)
        self.assertIn('Lokale Commits', result['message'])

    def test_current_version_needs_no_restart(self):
        storage._update_progress('running', 0, 'Start', 'run-current')
        result, restart = storage.apply_update()
        self.assertTrue(result['ok'])
        self.assertFalse(restart)
        self.assertIn('neuesten Stand', result['message'])
        progress = storage._update_progress_snapshot()
        self.assertEqual(progress['status'], 'complete')
        self.assertEqual(progress['percent'], 100)

    def test_progress_redacts_credentials_in_command_output(self):
        storage._update_progress('error', 5, 'https://user:secret@example.invalid/repository', 'run-redaction')
        logs = storage._update_progress_snapshot()['logs']
        self.assertNotIn('secret', logs[0])

    def test_progress_endpoint_rejects_non_admin(self):
        handler = object.__new__(storage.StorageHandler)
        handler.path = '/api/system/update/progress'
        handler._verified_session = ('user', False)
        handler._require_session = lambda path: True
        handler._auth_connection = lambda: nullcontext(object())
        handler._auth_employees = lambda connection: [{'id': 'user', 'auth': {'accessLevel': 'employee'}}]
        with mock.patch.object(storage, 'ensure_daily_backup'), mock.patch.object(handler, '_send_json') as send:
            handler.do_GET()
        self.assertEqual(send.call_args.kwargs['status'], 403)

    def test_only_admin_can_check_or_apply_updates(self):
        handler = object.__new__(storage.StorageHandler)
        handler._verified_session = ('user', False)
        handler._auth_connection = lambda: nullcontext(object())
        handler._auth_employees = lambda connection: [{'id': 'user', 'auth': {'accessLevel': 'employee'}}]
        with mock.patch.object(handler, '_send_json') as send, \
             mock.patch.object(storage, 'check_for_update') as check, \
             mock.patch.object(storage, 'apply_update') as apply:
            handler._handle_system_update(False)
            handler._handle_system_update(True)
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args.kwargs['status'], 403)
        check.assert_not_called()
        apply.assert_not_called()

    def test_git_metadata_and_data_cannot_be_served_through_traversal_or_symlinks(self):
        handler = object.__new__(storage.StorageHandler)
        (self.checkout / 'modules').mkdir()
        (self.checkout / 'metadata-link').symlink_to(self.checkout / '.git', target_is_directory=True)
        for path in ('/.git/config', '/modules/../.git/config',
                     '/metadata-link/config', '/modules/../data/db.sqlite'):
            with self.subTest(path=path), mock.patch.object(handler, '_send_json') as send:
                handler._serve_static(path)
                self.assertEqual(send.call_args.kwargs['status'], 403)


if __name__ == '__main__':
    unittest.main()
