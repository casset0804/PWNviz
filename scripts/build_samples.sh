#!/usr/bin/env bash
# Compile every teaching sample with the documented pedagogical flags.
# Usage: scripts/build_samples.sh [sample-id ...]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES_DIR="${PWNVIZ_SAMPLES_DIR:-$REPO_ROOT/samples}"

if ! command -v gcc >/dev/null 2>&1; then
  echo "error: gcc not found; install build-essential" >&2
  exit 1
fi

CFLAGS=(-g -O0 -fno-omit-frame-pointer -fno-inline -fno-pie -no-pie)

build_one() {
  local dir="$1"
  local id
  id="$(basename "$dir")"
  if [ ! -f "$dir/demo.c" ]; then
    echo "skip $id: no demo.c"
    return 0
  fi
  echo "== building $id =="
  set -x
  gcc "${CFLAGS[@]}" -o "$dir/demo" "$dir/demo.c"
  set +x
  file "$dir/demo" || true
}

if [ "$#" -gt 0 ]; then
  for id in "$@"; do
    build_one "$SAMPLES_DIR/$id"
  done
else
  found=0
  for dir in "$SAMPLES_DIR"/*/; do
    [ -d "$dir" ] || continue
    [ -f "$dir/demo.c" ] || continue
    found=1
    build_one "$dir"
  done
  if [ "$found" -eq 0 ]; then
    echo "error: no samples with demo.c under $SAMPLES_DIR" >&2
    exit 1
  fi
fi
