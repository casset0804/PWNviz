#!/usr/bin/env bash
# Visual regression run: real WSL/GDB backend + Vite dev server + Playwright.
#
# Usage: scripts/run_visual_tests.sh [playwright args...]
#   e.g. scripts/run_visual_tests.sh --grep "push rbp"
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_URL="${PWNVIZ_APP_URL:-http://127.0.0.1:5173}"
API_URL="${PWNVIZ_API_URL:-http://127.0.0.1:8000}"
SHOT_DIR="${PWNVIZ_SHOT_DIR:-$REPO_ROOT/docs/assets/presentation}"

BACKEND_STARTED=0
VITE_STARTED=0

cleanup() {
  if [ "$VITE_STARTED" -eq 1 ]; then
    echo "== stopping vite =="
    # Kill the vite process listening on the app port (best effort).
    if command -v powershell.exe >/dev/null 2>&1; then
      powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
    fi
  fi
  if [ "$BACKEND_STARTED" -eq 1 ]; then
    echo "== stopping backend =="
    wsl.exe -e bash -lc "pkill -f 'python -m app' 2>/dev/null" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

health_ok() {
  curl -sf "$API_URL/health" >/dev/null 2>&1
}

if health_ok; then
  echo "== backend already running at $API_URL =="
else
  echo "== starting backend (WSL) =="
  wsl.exe -e bash -lc "cd /mnt/f/Pwnvis/backend && PWNVIZ_RELOAD=0 nohup \$HOME/.venvs/pwnviz/bin/python -m app > /tmp/pwnviz-backend.log 2>&1 &"
  BACKEND_STARTED=1
  for _ in $(seq 1 60); do
    if health_ok; then break; fi
    sleep 1
  done
  if ! health_ok; then
    echo "error: backend did not become healthy; log:" >&2
    wsl.exe -e bash -lc "tail -40 /tmp/pwnviz-backend.log" 2>/dev/null | tr -d '\0' >&2 || true
    exit 1
  fi
fi

app_ok() {
  curl -sf "$APP_URL" >/dev/null 2>&1
}

if app_ok; then
  echo "== vite already running at $APP_URL =="
else
  echo "== starting vite dev server =="
  (cd "$REPO_ROOT/frontend" && npm run dev > /tmp/pwnviz-vite.log 2>&1 &)
  VITE_STARTED=1
  for _ in $(seq 1 60); do
    if app_ok; then break; fi
    sleep 1
  done
  if ! app_ok; then
    echo "error: vite did not start; log:" >&2
    tail -40 /tmp/pwnviz-vite.log >&2 || true
    exit 1
  fi
fi

mkdir -p "$SHOT_DIR"

echo "== running playwright =="
cd "$REPO_ROOT/frontend"
# Each spec defaults to its own docs/assets subdirectory (presentation for the
# V1.3 teaching checkpoints, stackmap-v1.3.1 for the clarity suite); override
# with PWNVIZ_SHOT_DIR if a single target directory is wanted.
npx playwright test "$@"
echo "== done: screenshots in $SHOT_DIR =="
