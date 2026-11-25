"""Periodic, public-address-only HTTP checks for project hosting."""

import http.client
import ipaddress
import json
import socket
import ssl
import time
from urllib.parse import urlsplit


INTERVAL_SECONDS = 300
HISTORY_LIMIT = 48


def is_public_address(value):
    address = ipaddress.ip_address(value)
    if not address.is_global:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped or any(address in ipaddress.ip_network(prefix) for prefix in
                                     ('64:ff9b::/96', '64:ff9b:1::/48', '2002::/16', '2001::/32')):
            return False
    return True


def check_url(url):
    started = time.monotonic()
    try:
        parsed = urlsplit(url)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.fragment or len(url) > 2048 or any(ord(char) < 32 or ord(char) == 127 for char in url)):
            raise ValueError('Nur HTTP(S)-URLs ohne Zugangsdaten oder Fragment sind erlaubt.')
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == 'https' else 80)
        if not port:
            raise ValueError('Ungültiger Port.')
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        if not addresses or any(not is_public_address(item[4][0]) for item in addresses):
            raise ValueError('Das Ziel muss ausschließlich öffentliche IP-Adressen verwenden.')
        family, socktype, proto, _, address = addresses[0]
        sock = socket.socket(family, socktype, proto)
        try:
            sock.settimeout(8)
            sock.connect(address)
            if parsed.scheme == 'https':
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=parsed.hostname)
            host = parsed.hostname
            if ':' in host:
                host = '[' + host + ']'
            if parsed.port:
                host += ':' + str(parsed.port)
            path = parsed.path or '/'
            if parsed.query:
                path += '?' + parsed.query
            request = ('GET ' + path + ' HTTP/1.1\r\nHost: ' + host
                       + '\r\nUser-Agent: ProjectDashboard-Monitor/1.0\r\nConnection: close\r\n\r\n')
            sock.sendall(request.encode('ascii'))
            response = http.client.HTTPResponse(sock)
            response.begin()
            status = response.status
            response.close()
        finally:
            sock.close()
        return {
            'status': 'up' if 200 <= status < 300 else ('redirect' if 300 <= status < 400 else 'down'),
            'httpStatus': status,
            'responseMs': round((time.monotonic() - started) * 1000),
            'error': '',
        }
    except (ValueError, UnicodeError, OSError, ssl.SSLError, http.client.HTTPException) as exc:
        return {'status': 'down', 'httpStatus': None,
                'responseMs': round((time.monotonic() - started) * 1000),
                'error': str(exc)[:240]}


def init_table(connection):
    connection.execute('CREATE TABLE IF NOT EXISTS hosting_checks ('
                       'id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, '
                       'url TEXT NOT NULL, checked_at TEXT NOT NULL, result TEXT NOT NULL)')
    connection.execute('CREATE INDEX IF NOT EXISTS hosting_checks_project ON hosting_checks(project_id, id DESC)')
    connection.commit()


def get_projects(connection):
    row = connection.execute('SELECT value FROM kv_store WHERE key = ?', ('pd_projects',)).fetchone()
    projects = json.loads(row[0]) if row else []
    if not isinstance(projects, list):
        raise ValueError('Projektliste ist ungültig.')
    return projects


def run_checks(open_connection, now):
    connection = open_connection()
    try:
        init_table(connection)
        projects = get_projects(connection)
    finally:
        connection.close()
    for project in projects:
        if not isinstance(project, dict):
            continue
        hosting = project.get('hosting') or {}
        url = hosting.get('url', '') if isinstance(hosting, dict) else ''
        project_id = str(project.get('id') or '')
        if not project_id or not isinstance(url, str) or not url:
            continue
        result = check_url(url)
        connection = open_connection()
        try:
            connection.execute('INSERT INTO hosting_checks(project_id, url, checked_at, result) VALUES (?, ?, ?, ?)',
                               (project_id, url, now(), json.dumps(result)))
            connection.execute('DELETE FROM hosting_checks WHERE project_id = ? AND id NOT IN '
                               '(SELECT id FROM hosting_checks WHERE project_id = ? ORDER BY id DESC LIMIT ?)',
                               (project_id, project_id, HISTORY_LIMIT))
            connection.commit()
        finally:
            connection.close()


def read_checks(connection):
    init_table(connection)
    rows = connection.execute('SELECT project_id, url, checked_at, result FROM hosting_checks ORDER BY id DESC').fetchall()
    checks = {}
    for project_id, url, checked_at, result in rows:
        history = checks.setdefault(project_id, [])
        item = json.loads(result)
        item.update(url=url, checkedAt=checked_at)
        history.append(item)
    return checks
