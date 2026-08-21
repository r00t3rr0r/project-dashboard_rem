import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import storage_server as storage


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
        storage.KV_SNAPSHOT_METADATA = None
        storage.KV_SNAPSHOT_REVISION = 0
        storage.BACKUP_DELAY_SECONDS = 60
        storage.ADMIN_PIN = 'test-pin'

        connection = storage.open_db_connection(storage.DB_PATH)
        connection.execute(
            'CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL)'
        )
        connection.commit()
        connection.close()

        cls.server = storage.DashboardHTTPServer(('127.0.0.1', 0), storage.StorageHandler)
        cls.base_url = 'http://127.0.0.1:' + str(cls.server.server_address[1])
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()

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
                'X-Admin-Pin': storage.ADMIN_PIN
            }
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode('utf-8'))

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


if __name__ == '__main__':
    unittest.main()