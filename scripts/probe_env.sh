#!/usr/bin/env bash
# PWNviz environment probe (read-only). Prints facts about the host toolchain.
set -u
echo "=== OS ==="
uname -a
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo
echo "=== python ==="
python3 --version 2>&1
python3 -m pip --version 2>&1
for m in pygdbmi fastapi uvicorn pydantic pytest; do
  python3 - "$m" <<'PY' 2>&1
import importlib, sys
name = sys.argv[1]
try:
    mod = importlib.import_module(name)
    print(f"{name}: {getattr(mod, '__version__', 'installed')}")
except Exception as exc:
    print(f"{name}: MISSING ({exc.__class__.__name__})")
PY
done
echo
echo "=== gdb ==="
which gdb 2>&1
gdb --version 2>&1 | head -1
echo "-- gdb python --"
gdb -batch -nx -ex 'python import sys; print(sys.version.split()[0])' 2>&1 | head -3
echo "-- gdb mi3 support --"
gdb --batch --interpreter=mi3 -ex '-gdb-version' 2>&1 | head -3
echo
echo "=== pwndbg ==="
for p in /opt/pwndbg /usr/share/pwndbg "$HOME/pwndbg"; do
  [ -e "$p" ] && echo "found: $p"
done
if [ -f "$HOME/.gdbinit" ]; then echo "-- ~/.gdbinit --"; cat "$HOME/.gdbinit"; else echo "no ~/.gdbinit"; fi
echo
echo "=== compilers/binutils ==="
which gcc 2>&1 && gcc --version 2>&1 | head -1
which objdump 2>&1 && objdump --version 2>&1 | head -1
echo
echo "=== node ==="
which node 2>&1 && node -v 2>&1
which npm 2>&1 && npm -v 2>&1
which pnpm 2>&1 && pnpm -v 2>&1
echo
echo "=== ptrace scope ==="
cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo "n/a"
echo
echo "=== done ==="
