"""Capture public pages in a networkless container via a restricted relay."""

import base64
import binascii
import json
import queue
import re
import socket
import subprocess
import threading
import time
import uuid
from urllib.parse import urlsplit

from hosting_monitor import is_public_address


IMAGE = 'project-dashboard-screenshot:1'
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_LINE_BYTES = 8 * 1024 * 1024
TIMEOUT_SECONDS = 45


def parse_target(url):
    parsed = urlsplit(url)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.fragment or len(url) > 2048
            or any(ord(char) < 32 or ord(char) == 127 for char in url)):
        raise ValueError('Nur HTTP(S)-URLs ohne Zugangsdaten oder Fragment sind erlaubt.')
    port = parsed.port if parsed.port is not None else (443 if parsed.scheme == 'https' else 80)
    if not port:
        raise ValueError('Ungültiger Port.')
    return parsed.hostname.encode('idna').decode('ascii').lower(), port


def connect_public(host, port):
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not is_public_address(item[4][0]) for item in addresses):
        raise ValueError('Das Ziel muss ausschließlich öffentliche IP-Adressen verwenden.')
    family, kind, proto, _, address = addresses[0]
    remote = socket.socket(family, kind, proto)
    try:
        remote.settimeout(8)
        remote.connect(address)
        return remote
    except OSError:
        remote.close()
        raise


def capture(url):
    host, port = parse_target(url)
    name = 'pd-screenshot-' + uuid.uuid4().hex
    command = [
        'docker', 'run', '--pull', 'never', '--rm', '-i', '--name', name, '--network', 'none',
        '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '128', '--memory', '768m', '--cpus', '1',
        '--user', '10001:10001', IMAGE,
    ]
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, bufsize=0)
    except OSError as exc:
        raise RuntimeError('Docker konnte nicht gestartet werden: ' + str(exc)) from exc

    output = queue.Queue()
    sockets = {}
    locks = threading.Lock()
    writer = threading.Lock()
    opened_count = 0

    def send(message):
        data = (json.dumps(message, separators=(',', ':')) + '\n').encode()
        with writer:
            if process.poll() is None:
                try:
                    process.stdin.write(data)
                except (BrokenPipeError, OSError):
                    pass

    def close_channel(channel):
        with locks:
            remote = sockets.pop(channel, None)
        if remote:
            remote.close()
        send({'type': 'close', 'id': channel})

    def read_remote(channel, remote):
        try:
            while True:
                data = remote.recv(32768)
                if not data:
                    break
                send({'type': 'data', 'id': channel, 'data': base64.b64encode(data).decode('ascii')})
        except OSError:
            pass
        finally:
            close_channel(channel)

    def open_channel(channel, target, target_port):
        try:
            remote = connect_public(target, target_port)
            with locks:
                if channel not in sockets:
                    remote.close()
                    return
                sockets[channel] = remote
            send({'type': 'opened', 'id': channel})
            read_remote(channel, remote)
        except (OSError, ValueError):
            close_channel(channel)

    def read_output():
        try:
            while True:
                line = process.stdout.readline(MAX_LINE_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_LINE_BYTES or not line.endswith(b'\n'):
                    output.put(RuntimeError('Screenshot-Antwort ist zu groß.'))
                    break
                output.put(json.loads(line))
        except (OSError, ValueError) as exc:
            output.put(RuntimeError('Ungültige Screenshot-Antwort: ' + str(exc)))
        finally:
            output.put(None)

    output_thread = threading.Thread(target=read_output, daemon=True)
    output_thread.start()
    deadline = time.monotonic() + TIMEOUT_SECONDS
    send({'type': 'init', 'url': url})
    try:
        while True:
            try:
                message = output.get(timeout=max(0.01, deadline - time.monotonic()))
            except queue.Empty as exc:
                raise RuntimeError('Screenshot-Erstellung hat zu lange gedauert.') from exc
            if message is None:
                raise RuntimeError('Screenshot-Container beendet. Ist das Docker-Image eingerichtet?')
            if isinstance(message, Exception):
                raise message
            if not isinstance(message, dict):
                raise RuntimeError('Ungültige Screenshot-Antwort.')
            kind = message.get('type')
            channel = str(message.get('id', ''))
            if kind == 'open':
                target = str(message.get('host', '')).strip('[]').lower()
                target_port = message.get('port')
                if (not re.fullmatch(r'\d{1,8}', channel) or target != host
                        or not isinstance(target_port, int) or target_port not in (80, 443, port)):
                    send({'type': 'close', 'id': channel})
                    continue
                with locks:
                    if len(sockets) >= 16 or opened_count >= 100 or channel in sockets:
                        allowed = False
                    else:
                        sockets[channel] = None
                        opened_count += 1
                        allowed = True
                if not allowed:
                    send({'type': 'close', 'id': channel})
                    continue
                threading.Thread(target=open_channel, args=(channel, target, target_port), daemon=True).start()
            elif kind == 'data':
                try:
                    data = base64.b64decode(message.get('data', ''), validate=True)
                    if len(data) > 65536:
                        raise ValueError('Datenpaket zu groß')
                    with locks:
                        remote = sockets.get(channel)
                    if remote:
                        remote.sendall(data)
                except (ValueError, binascii.Error, OSError):
                    close_channel(channel)
            elif kind == 'close':
                close_channel(channel)
            elif kind == 'error':
                raise RuntimeError('Screenshot fehlgeschlagen: ' + str(message.get('error', 'Unbekannter Fehler'))[:300])
            elif kind == 'done':
                try:
                    image = base64.b64decode(message.get('data', ''), validate=True)
                except (ValueError, binascii.Error) as exc:
                    raise RuntimeError('Screenshot-Antwort ist ungültig.') from exc
                if not image.startswith(b'\x89PNG\r\n\x1a\n') or len(image) > MAX_IMAGE_BYTES:
                    raise RuntimeError('Screenshot ist kein gültiges PNG oder zu groß.')
                return image
            if time.monotonic() >= deadline:
                raise RuntimeError('Screenshot-Erstellung hat zu lange gedauert.')
    finally:
        with locks:
            active = list(sockets.values())
            sockets.clear()
        for remote in active:
            if remote:
                remote.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        output_thread.join(timeout=5)
        process.stdin.close()
        process.stdout.close()
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10, check=False)
