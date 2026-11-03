#!/usr/bin/env bash
# Start the PWNviz backend from its virtualenv (run inside WSL/Ubuntu).
#
# Reads GDB_PATH / PWNDBG_INIT / API_HOST / API_PORT / ALLOWED_SAMPLE_DIR from
# the environment and from <repo>/.env. Auto-reload is on by default for
# development; set PWNVIZ_RELOAD=0 to disable it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${PWNVIZ_VENV:-$HOME/.venvs/pwnviz}"

if [ ! -x "$VENV/bin/uvicorn" ]; then
  echo "error: backend venv missing at $VENV; run scripts/wsl_bootstrap.sh" >&2
  exit 1
fi

cd "$REPO_ROOT/backend"
export PWNVIZ_RELOAD="${PWNVIZ_RELOAD:-1}"
exec "$VENV/bin/python" -m app
