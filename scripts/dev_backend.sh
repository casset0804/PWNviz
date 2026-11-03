#!/usr/bin/env bash
# Start the PWNviz backend from its virtualenv (run inside WSL/Ubuntu).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${PWNVIZ_VENV:-$HOME/.venvs/pwnviz}"
PORT="${PWNVIZ_PORT:-8000}"

if [ ! -x "$VENV/bin/uvicorn" ]; then
  echo "error: backend venv missing at $VENV; run scripts/wsl_bootstrap.sh" >&2
  exit 1
fi

cd "$REPO_ROOT/backend"
exec "$VENV/bin/uvicorn" app.main:app \
  --host "${PWNVIZ_HOST:-127.0.0.1}" \
  --port "$PORT" \
  --reload
