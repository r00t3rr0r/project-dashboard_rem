import json
import os
import socket
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import hosting_monitor as monitor


class HostingMonitorTest(unittest.TestCase):
    def test_private_mixed_and_translated_addresses_are_rejected(self):
        for address in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '::1',
                        '::ffff:127.0.0.1', '64:ff9b::a00:1', '2002:0a00:0001::'):
            with self.subTest(address=address):
                self.assertFalse(monitor.is_public_address(address))
        self.assertTrue(monitor.is_public_address('8.8.8.8'))
        with mock.patch.object(monitor.socket, 'getaddrinfo', return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 80)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 80)),
        ]), mock.patch.object(monitor.socket, 'socket') as create_socket:
            result = monitor.check_url('http://example.test/')
            self.assertEqual(result['status'], 'down')
            self.assertIn('öffentliche', result['error'])
            create_socket.assert_not_called()

    def test_rejects_credentials_and_does_not_follow_redirects(self):
        self.assertEqual(monitor.check_url('https://user:pass@example.com/')['status'], 'down')
        fake_socket = mock.MagicMock()
        response = mock.MagicMock(status=302)
        with mock.patch.object(monitor.socket, 'getaddrinfo', return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 80)),
        ]), mock.patch.object(monitor.socket, 'socket', return_value=fake_socket), \
                mock.patch.object(monitor.http.client, 'HTTPResponse', return_value=response):
            result = monitor.check_url('http://example.com/path')
        self.assertEqual(result['status'], 'redirect')
        fake_socket.connect.assert_called_once_with(('8.8.8.8', 80))
        fake_socket.sendall.assert_called_once()

    def test_checks_are_persisted_and_history_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'test.sqlite')
            def connect():
                return sqlite3.connect(path)
            connection = connect()
            connection.execute('CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            connection.execute('INSERT INTO kv_store VALUES (?, ?)', ('pd_projects', json.dumps([
                {'id': 'p1', 'hosting': {'url': 'https://example.com/'}},
                {'id': 'p2'},
            ])))
            connection.commit()
            connection.close()
            with mock.patch.object(monitor, 'check_url', return_value={
                'status': 'up', 'httpStatus': 200, 'responseMs': 12, 'error': ''
            }) as check:
                for _ in range(monitor.HISTORY_LIMIT + 2):
                    monitor.run_checks(connect, lambda: '2030-01-01T00:00:00Z')
                self.assertEqual(check.call_count, monitor.HISTORY_LIMIT + 2)
            connection = connect()
            checks = monitor.read_checks(connection)
            connection.close()
            self.assertEqual(len(checks['p1']), monitor.HISTORY_LIMIT)
            self.assertEqual(checks['p1'][0]['url'], 'https://example.com/')
            self.assertEqual(checks['p1'][0]['responseMs'], 12)
            self.assertNotIn('p2', checks)


if __name__ == '__main__':
    unittest.main()
