import http.server
import os
import socket
import struct
import sys
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import screenshot_capture as screenshot


class ScreenshotSafetyTest(unittest.TestCase):
    def test_rejects_bad_urls_and_private_dns(self):
        for value in ('file:///etc/passwd', 'https://user:password@example.com/', 'http://example.com/#fragment'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                screenshot.parse_target(value)
        with mock.patch.object(screenshot.socket, 'getaddrinfo', return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 80)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 80)),
        ]), mock.patch.object(screenshot.socket, 'socket') as create_socket:
            with self.assertRaises(ValueError):
                screenshot.connect_public('example.com', 80)
            create_socket.assert_not_called()

    @unittest.skipUnless(os.environ.get('RUN_SCREENSHOT_CONTAINER_TEST') == '1', 'Docker integration test is opt-in')
    def test_networkless_browser_captures_page_via_relay(self):
        class Fixture(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                content = b'<html><body style="background:#3267ab"><h1>Isolated screenshot test</h1></body></html>'
                self.send_response(200)
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def local_fixture(host, port):
                self.assertEqual((host, port), ('screenshot.example.test', 80))
                return socket.create_connection(server.server_address, timeout=5)

            with mock.patch.object(screenshot, 'connect_public', side_effect=local_fixture):
                image = screenshot.capture('http://screenshot.example.test/')
            self.assertEqual(image[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual(struct.unpack('>II', image[16:24]), (1280, 800))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
