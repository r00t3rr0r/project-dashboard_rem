#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_ROOT=${SCRIPT_DIR:h}

HOST=${PROJECT_DASHBOARD_STORAGE_HOST:-0.0.0.0}
PORT=${PROJECT_DASHBOARD_STORAGE_PORT:-8766}
PYTHON_BIN=${PROJECT_DASHBOARD_PYTHON_BIN:-python3}

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "[ERROR] Python executable not found: $PYTHON_BIN"
  echo "Set PROJECT_DASHBOARD_PYTHON_BIN to a valid interpreter."
  exit 1
fi

LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
  if [[ -z "$LAN_IP" ]]; then
    LAN_IP=$(ipconfig getifaddr en1 2>/dev/null || true)
  fi
fi

echo "[projekt-dashboard] Starting storage server"
echo "  host:   $HOST"
echo "  port:   $PORT"
echo "  python: $PYTHON_BIN"
echo ""
if [[ -n "$LAN_IP" ]]; then
  echo "Open from this Mac:    http://127.0.0.1:$PORT/app.html"
  echo "Open from your LAN:    http://$LAN_IP:$PORT/app.html"
else
  echo "Open from this Mac:    http://127.0.0.1:$PORT/app.html"
fi
echo "Stop server with Ctrl+C."
echo ""

cd "$PROJECT_ROOT"
exec env PROJECT_DASHBOARD_STORAGE_HOST="$HOST" PROJECT_DASHBOARD_STORAGE_PORT="$PORT" "$PYTHON_BIN" storage_server.py