#!/usr/bin/env bash
# Run the PWNviz backend test-suite inside the project virtualenv.
#
# Usage:
#   bash scripts/run_backend_tests.sh                 # everything
#   bash scripts/run_backend_tests.sh tests/unit -q   # a subset
#   PWNVIZ_PYTHON=/path/to/python bash scripts/run_backend_tests.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

PYTHON_BIN="${PWNVIZ_PYTHON:-$HOME/.venvs/pwnviz/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3)"
fi

echo "python: $PYTHON_BIN"
exec "$PYTHON_BIN" -m pytest "$@"
