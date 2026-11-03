#!/usr/bin/env bash
# PWNviz host readiness check. Read-only: installs nothing, never fabricates results.
# Exit code 0 only when the backend can create a real GDB/MI3 session.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${PWNVIZ_VENV:-$HOME/.venvs/pwnviz}"
FAILURES=0
WARNINGS=0

pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
warn() { printf '  [WARN] %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
info() { printf '  [INFO] %s\n' "$1"; }

echo "== platform =="
if [ "$(uname -s)" = "Linux" ]; then
  pass "$(uname -sr) ($(uname -m))"
else
  fail "PWNviz debugger requires Linux; found $(uname -s). Use WSL2/Ubuntu."
fi

echo "== gdb =="
GDB_BIN="${PWNVIZ_GDB_BINARY:-gdb}"
if ! command -v "$GDB_BIN" >/dev/null 2>&1; then
  fail "gdb not found (set PWNVIZ_GDB_BINARY or apt install gdb)"
else
  GDB_VERSION_LINE="$("$GDB_BIN" --version 2>&1 | head -1)"
  GDB_VERSION="$(printf '%s\n' "$GDB_VERSION_LINE" | sed -n 's/.*) \([0-9][0-9.]*\).*/\1/p')"
  if [ -z "$GDB_VERSION" ]; then
    fail "cannot parse GDB version from: $GDB_VERSION_LINE"
  else
    pass "GDB $GDB_VERSION ($(command -v "$GDB_BIN"))"
    if [ "$(printf '%s\n12.1\n' "$GDB_VERSION" | sort -V | head -1)" = "12.1" ]; then
      pass "GDB $GDB_VERSION meets the 12.1 minimum"
    else
      fail "GDB $GDB_VERSION is older than the required 12.1"
    fi
  fi

  PYVER="$("$GDB_BIN" --batch -nx --quiet -ex "python import sys;print(sys.version.split()[0])" 2>/dev/null | tail -1)"
  if [ -n "$PYVER" ]; then
    pass "GDB embedded Python $PYVER"
  else
    fail "GDB has no embedded Python"
  fi

  # GDB 12.1 exits 0 even for an unknown interpreter, so verify the marker and
  # reject the "unrecognized" diagnostic instead of trusting the exit code.
  MI3_OUT="$(timeout 15 "$GDB_BIN" --batch -nx --quiet --interpreter=mi3 \
    -ex "python print('PWNVIZ_MI3_OK')" 2>&1 || true)"
  if printf '%s' "$MI3_OUT" | grep -q 'PWNVIZ_MI3_OK' \
    && ! printf '%s' "$MI3_OUT" | grep -qi 'unrecognized'; then
    pass "GDB/MI3 interpreter accepted"
  else
    fail "GDB/MI3 interpreter not accepted: $(printf '%s' "$MI3_OUT" | head -2 | tr '\n' ' ')"
  fi
fi

echo "== pwndbg (optional) =="
PWNDBG_DIR=""
for candidate in "${PWNVIZ_PWNDBG_PATH:-}" "${PWNDBG_GDB_PATH:-}" \
  "$(sed -n 's/^source \(.*gdbinit\.py\).*/\1/p' "$HOME/.gdbinit" 2>/dev/null | head -1)" \
  /opt/pwndbg /usr/share/pwndbg "$HOME/pwndbg"; do
  [ -n "$candidate" ] || continue
  if [ -f "$candidate" ]; then candidate="$(dirname "$candidate")"; fi
  if [ -f "$candidate/gdbinit.py" ]; then PWNDBG_DIR="$candidate"; break; fi
done
if [ -z "$PWNDBG_DIR" ]; then
  warn "pwndbg not found; native GDB still fully supported"
else
  OUT="$(timeout 45 "${GDB_BIN:-gdb}" --batch -nx --quiet \
    -ex "source $PWNDBG_DIR/gdbinit.py" \
    -ex "python print('PWNVIZ_PWNDBG_OK')" 2>&1 | sed 's/\x1b\[[0-9;?]*[A-Za-z]//g')"
  if printf '%s' "$OUT" | grep -q 'PWNVIZ_PWNDBG_OK'; then
    pass "pwndbg loads from $PWNDBG_DIR"
  else
    warn "pwndbg found at $PWNDBG_DIR but failed to load; will degrade to native GDB"
  fi
fi

echo "== toolchain =="
if command -v gcc >/dev/null 2>&1; then
  pass "gcc $(gcc -dumpfullversion 2>/dev/null || gcc -dumpversion)"
else
  fail "gcc not found"
fi
if command -v objdump >/dev/null 2>&1; then
  pass "$(objdump --version | head -1)"
else
  warn "objdump not found (not required)"
fi

echo "== backend python env =="
if [ -x "$VENV/bin/python" ]; then
  pass "venv $VENV"
  if "$VENV/bin/python" - <<'PY'
import sys
missing = []
for name in ("fastapi", "uvicorn", "pydantic", "pygdbmi", "pytest"):
    try:
        __import__(name)
    except ImportError:
        missing.append(name)
if missing:
    print("missing backend packages: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
PY
  then
    pass "backend packages import (fastapi, uvicorn, pydantic, pygdbmi, pytest)"
  else
    fail "backend packages missing; run scripts/wsl_bootstrap.sh"
  fi
else
  fail "backend venv missing; run scripts/wsl_bootstrap.sh"
fi

echo "== sample binary =="
if [ -x "$REPO_ROOT/samples/stack-basic/demo" ]; then
  pass "samples/stack-basic/demo built"
else
  warn "samples/stack-basic/demo not built; run scripts/build_samples.sh"
fi

echo "== frontend tooling (informational) =="
if command -v node >/dev/null 2>&1; then
  pass "node $(node -v) in WSL"
else
  info "node is not installed in WSL; run the Vite dev server from Windows (npm run dev)"
fi

echo
echo "== summary: $FAILURES failure(s), $WARNINGS warning(s) =="
[ "$FAILURES" -eq 0 ] || exit 1
echo "Backend prerequisites satisfied. Run: scripts/dev_backend.sh"
