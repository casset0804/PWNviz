#!/usr/bin/env bash
# Probe pwndbg: where it is, whether it loads into GDB 12.1, and how long that takes.
set -u
for p in "${PWNDBG_GDB_PATH:-}" /home/casset/pwndbg /opt/pwndbg /usr/share/pwndbg "$HOME/pwndbg"; do
  [ -n "$p" ] && [ -f "$p/gdbinit.py" ] && { echo "gdbinit: $p/gdbinit.py"; PWNDBG_DIR="$p"; break; }
done
if [ -z "${PWNDBG_DIR:-}" ]; then
  echo "pwndbg: NOT FOUND"
  exit 0
fi
cd "$PWNDBG_DIR" || exit 1
echo "-- git --"
git log -1 --format='%H %ad' --date=short 2>&1 | head -1
echo "-- files --"
ls | head -15
echo "-- load (timeout 90s) --"
start=$(date +%s)
timeout 90 gdb --batch -nx \
  -ex "source $PWNDBG_DIR/gdbinit.py" \
  -ex "pi print('PWNDBG_LOADED', __import__('pwndbg').__file__)" \
  2>&1 | tail -25
rc=$?
end=$(date +%s)
echo "-- exit=$rc elapsed=$((end-start))s --"
