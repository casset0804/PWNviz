#!/usr/bin/env bash
# Create/refresh the PWNviz backend virtualenv and install dependencies.
#
# The venv lives on the WSL ext4 filesystem by default (fast), not on the
# /mnt/f DrvFs mount where this repository resides. Override with PWNVIZ_VENV.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${PWNVIZ_VENV:-$HOME/.venvs/pwnviz}"

echo "== repo: $REPO_ROOT =="
echo "== venv: $VENV =="
if [ ! -d "$REPO_ROOT/backend" ]; then
  echo "error: backend directory missing" >&2
  exit 1
fi

if [ ! -x "$VENV/bin/python" ]; then
  mkdir -p "$(dirname "$VENV")"
  python3 -m venv "$VENV"
fi

"$VENV/bin/python" -V
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet \
  "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2.6" \
  "pygdbmi>=0.11" "python-dotenv>=1.0" "pytest>=8" \
  "pytest-asyncio>=0.23" "httpx>=0.27"

echo "== installed =="
"$VENV/bin/python" - <<'PY'
import importlib
for name in ("fastapi", "uvicorn", "pydantic", "pygdbmi", "dotenv", "pytest"):
    mod = importlib.import_module(name)
    print(f"{name}: {getattr(mod, '__version__', 'unknown')}")
PY

echo
echo "Activate with: source $VENV/bin/activate"
