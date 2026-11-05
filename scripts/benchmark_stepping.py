#!/usr/bin/env python3
"""Measure real single-step cost of the PWNviz debug pipeline.

The harness starts a real GDB, loads a real ELF, performs real
``-exec-step-instruction`` calls and reports per-step wall-clock cost plus the
exact number of GDB/MI commands each snapshot needed.

It is deliberately version agnostic so the *same* script can measure the
pre-optimization baseline and the optimized implementation:

* MI commands are counted by wrapping ``MIController.execute`` (present in both
  versions) rather than by reading the new perf fields;
* the new ``snapshot.perf`` block is reported when present and omitted when the
  backend predates it;
* the run protocol (warm-up, step count, session reset cadence) is identical in
  both runs, so the numbers are directly comparable.

Usage (from the repository root, inside WSL):

    ~/.venvs/pwnviz/bin/python scripts/benchmark_stepping.py \
        --label baseline --steps 100 --out docs/benchmarks/baseline.json

Options:
    --steps N          measured step_instruction calls (default 100)
    --warmup N         discarded steps before measuring (default 5)
    --reset-every N    restart the session every N steps (default 25; keeps the
                       run inside the sample's own code instead of libc)
    --sample ID        teaching sample (default stack-basic)
    --stop-at SYMBOL   initial breakpoint (default main)
    --mode fast|full   requested snapshot mode (ignored by older backends)
    --out PATH         JSON report path (default docs/benchmarks/<label>.json)
    --label NAME       label stored in the report
    --quiet            only print the summary
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Tests and the harness must see documented defaults, not a developer's .env.
os.environ.setdefault("PWNVIZ_DISABLE_DOTENV", "1")
os.environ.setdefault("PWNVIZ_LOAD_PWNDBG", "0")
os.environ.setdefault("ALLOWED_SAMPLE_DIR", str(REPO_ROOT / "samples"))

from app.core.config import get_settings  # noqa: E402
from app.debugger.mi_controller import MIController  # noqa: E402
from app.schemas.session import CreateSessionRequest  # noqa: E402
from app.sessions.manager import SessionManager  # noqa: E402
from app.sessions.state import SessionState  # noqa: E402

# One entry per MI round trip: ("-data-read-memory-bytes", milliseconds).
_COMMAND_RECORDS: list[tuple[str, float]] = []


def _command_key(command: str) -> str:
    text = command.strip()
    return text.split(None, 1)[0][:64] if text else "?"


def install_command_recorder() -> None:
    """Wrap ``MIController.execute`` so every MI round trip is timed."""
    original = MIController.execute
    if getattr(original, "__pwnviz_benchmark__", False):  # pragma: no cover
        return

    async def instrumented(self, command, *args, **kwargs):  # type: ignore[no-untyped-def]
        started = time.perf_counter()
        try:
            return await original(self, command, *args, **kwargs)
        finally:
            _COMMAND_RECORDS.append(
                (_command_key(command), (time.perf_counter() - started) * 1000.0)
            )

    instrumented.__pwnviz_benchmark__ = True  # type: ignore[attr-defined]
    MIController.execute = instrumented  # type: ignore[method-assign]


def take_commands() -> list[tuple[str, float]]:
    records = list(_COMMAND_RECORDS)
    _COMMAND_RECORDS.clear()
    return records


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 3)
    position = fraction * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    weight = position - low
    return round(ordered[low] * (1 - weight) + ordered[high] * weight, 3)


def summarise(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {
            "count": 0,
            "min": 0.0,
            "p50": 0.0,
            "p95": 0.0,
            "max": 0.0,
            "mean": 0.0,
            "stdev": 0.0,
        }
    return {
        "count": len(values),
        "min": round(min(values), 3),
        "p50": percentile(values, 0.50),
        "p95": percentile(values, 0.95),
        "max": round(max(values), 3),
        "mean": round(statistics.fmean(values), 3),
        "stdev": round(statistics.pstdev(values), 3) if len(values) > 1 else 0.0,
    }


def ensure_sample_built(sample_dir: Path) -> Path:
    """Compile the teaching sample exactly like the test-suite does."""
    source = sample_dir / "demo.c"
    binary = sample_dir / "demo"
    if not source.is_file():
        raise SystemExit(f"sample source missing: {source}")
    if binary.is_file():
        return binary
    gcc = shutil.which("gcc")
    if gcc is None:
        raise SystemExit("gcc is required to build the teaching sample")
    command = [
        gcc,
        "-g",
        "-O0",
        "-fno-omit-frame-pointer",
        "-fno-inline",
        "-fno-pie",
        "-no-pie",
        "-o",
        str(binary),
        str(source),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise SystemExit(f"gcc failed: {result.stderr}")
    return binary


def gdb_version(binary: str) -> str:
    try:
        result = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=30
        )
        return (result.stdout.splitlines() or ["unknown"])[0]
    except (OSError, subprocess.SubprocessError):
        return "unavailable"


def git_commit() -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def snapshot_bytes(snapshot: Any) -> int:
    try:
        payload = snapshot.model_dump(mode="json")
        return len(json.dumps(payload, separators=(",", ":")))
    except Exception:
        return 0


def snapshot_perf(snapshot: Any) -> dict[str, Any] | None:
    perf = getattr(snapshot, "perf", None)
    if perf is None:
        return None
    try:
        return perf.model_dump(mode="json")
    except Exception:
        return None


async def open_session(
    manager: SessionManager, request: CreateSessionRequest
):
    session = await manager.create(request)
    launched = await session.launch()
    return session, launched


async def run(args: argparse.Namespace) -> dict[str, Any]:
    settings = get_settings()
    sample_dir = settings.samples_dir / args.sample
    ensure_sample_built(sample_dir)
    request = CreateSessionRequest(
        sample_id=args.sample, stop_at=args.stop_at, load_pwndbg=False
    )

    install_command_recorder()
    manager = SessionManager()
    steps: list[dict[str, Any]] = []
    resets = 0
    total_attempts = 0
    max_attempts = (args.steps + args.warmup) * 3 + 20

    session, launched = await open_session(manager, request)
    if launched is None:
        raise SystemExit("initial snapshot was not produced")

    launch_records = take_commands()
    launch_info = {
        "total_ms": round(sum(duration for _name, duration in launch_records), 3),
        "mi_command_count": len(launch_records),
        "mi_by_command": _count_by_name(launch_records),
        "payload_bytes": snapshot_bytes(launched),
        "perf": snapshot_perf(launched),
    }
    print(
        f"launch snapshot: {launch_info['mi_command_count']} MI commands, "
        f"{launch_info['total_ms']:.1f} ms, {launch_info['payload_bytes']} bytes"
    )

    measured = 0
    warmup_left = args.warmup
    since_reset = 0
    while measured < args.steps:
        total_attempts += 1
        if total_attempts > max_attempts:
            print("stopping: too many attempts without enough measurable steps")
            break
        if since_reset >= args.reset_every:
            await manager.terminate(session.session_id)
            session, launched = await open_session(manager, request)
            take_commands()
            since_reset = 0
            resets += 1
            if launched is None:
                raise SystemExit("session restart produced no snapshot")

        take_commands()
        started = time.perf_counter()
        state, snapshot = await session.action("step_instruction")
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        records = take_commands()
        since_reset += 1
        if snapshot is None or state in {
            SessionState.EXITED,
            SessionState.ERROR,
            SessionState.TERMINATED,
        }:
            await manager.terminate(session.session_id)
            session, launched = await open_session(manager, request)
            take_commands()
            since_reset = 0
            resets += 1
            continue
        if warmup_left > 0:
            warmup_left -= 1
            continue

        steps.append(
            {
                "index": len(steps) + 1,
                "total_ms": round(elapsed_ms, 3),
                "mi_command_count": len(records),
                "mi_time_ms": round(sum(value for _name, value in records), 3),
                "mi_by_command": _count_by_name(records),
                "payload_bytes": snapshot_bytes(snapshot),
                "fast_available": bool(getattr(snapshot, "frames_state", None)),
                "frames_state": getattr(snapshot, "frames_state", None),
                "variables_state": getattr(snapshot, "variables_state", None),
                "stack_read_commands": _count_name(records, "-data-read-memory-bytes"),
                "variable_commands": sum(
                    count
                    for name, count in _count_by_name(records).items()
                    if name.startswith("-var-")
                    or name in {"-stack-list-variables", "-data-evaluate-expression"}
                ),
                "perf": snapshot_perf(snapshot),
            }
        )
        measured += 1
        if not args.quiet and measured % 10 == 0:
            print(f"  measured {measured}/{args.steps} steps")

    await manager.shutdown()

    totals = [step["total_ms"] for step in steps]
    mi_counts = [float(step["mi_command_count"]) for step in steps]
    payloads = [float(step["payload_bytes"]) for step in steps]
    stack_reads = [float(step["stack_read_commands"]) for step in steps]
    variable_commands = [float(step["variable_commands"]) for step in steps]
    by_command: dict[str, int] = {}
    for step in steps:
        for name, count in step["mi_by_command"].items():
            by_command[name] = by_command.get(name, 0) + int(count)

    stage_names = (
        "registers_ms",
        "frames_ms",
        "disassembly_ms",
        "memory_ms",
        "variables_ms",
        "diff_ms",
    )
    stage_summary: dict[str, Any] = {}
    for stage in stage_names:
        values = [
            float(step["perf"][stage])
            for step in steps
            if step.get("perf") and step["perf"].get(stage) is not None
        ]
        if values:
            stage_summary[stage] = summarise(values)

    report: dict[str, Any] = {
        "label": args.label,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "protocol": {
            "steps": args.steps,
            "warmup": args.warmup,
            "reset_every": args.reset_every,
            "sample": args.sample,
            "stop_at": args.stop_at,
            "requested_mode": args.mode,
            "mi_settle_seconds": args.settle,
            "resets": resets,
        },
        "environment": {
            "git_commit": git_commit(),
            "gdb": gdb_version(settings.gdb_binary),
            "python": platform.python_version(),
            "platform": platform.platform(),
            "stack_window_below": settings.stack_window_below,
            "stack_window_above": settings.stack_window_above,
            "memory_chunk_size": settings.memory_chunk_size,
            "snapshot_mode_default": getattr(settings, "snapshot_mode_default", None),
            "memory_batch_max_bytes": getattr(
                settings, "memory_batch_max_bytes", None
            ),
        },
        "launch": launch_info,
        "summary": {
            "total_ms": summarise(totals),
            "mi_command_count": summarise(mi_counts),
            "payload_bytes": summarise(payloads),
            "stack_read_commands": summarise(stack_reads),
            "variable_commands": summarise(variable_commands),
            "mi_time_ms": summarise([step["mi_time_ms"] for step in steps]),
            "stages_ms": stage_summary,
            "mi_by_command": dict(sorted(by_command.items())),
        },
        "steps": steps,
    }
    return report


def _count_by_name(records: list[tuple[str, float]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name, _duration in records:
        counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items()))


def _count_name(records: list[tuple[str, float]], name: str) -> int:
    return sum(1 for command, _duration in records if command == name)


def print_summary(report: dict[str, Any]) -> None:
    summary = report["summary"]
    total = summary["total_ms"]
    commands = summary["mi_command_count"]
    print("")
    print(f"=== {report['label']} ({report['protocol']['steps']} steps) ===")
    print(
        f"step wall time   p50 {total['p50']:7.2f} ms  p95 {total['p95']:7.2f} ms  "
        f"max {total['max']:7.2f} ms  mean {total['mean']:7.2f} ms"
    )
    print(
        f"MI commands/step p50 {commands['p50']:7.1f}     p95 {commands['p95']:7.1f}     "
        f"max {commands['max']:7.0f}     mean {commands['mean']:7.2f}"
    )
    print(
        f"stack reads/step mean {summary['stack_read_commands']['mean']:.2f}   "
        f"variable commands/step mean {summary['variable_commands']['mean']:.2f}"
    )
    print(f"payload bytes    mean {summary['payload_bytes']['mean']:.0f}")
    if summary["stages_ms"]:
        parts = "  ".join(
            f"{name.replace('_ms', '')} {values['mean']:.2f}"
            for name, values in summary["stages_ms"].items()
        )
        print(f"stage mean ms    {parts}")
    print("MI commands by name in measured steps:")
    for name, count in summary["mi_by_command"].items():
        print(f"  {name:34s} {count:5d}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--reset-every", type=int, default=25)
    parser.add_argument("--sample", default="stack-basic")
    parser.add_argument("--stop-at", default="main")
    parser.add_argument("--mode", choices=("fast", "full"), default="fast")
    parser.add_argument(
        "--settle",
        type=float,
        default=None,
        help="Override PWNVIZ_MI_SETTLE_SECONDS to isolate per-command latency.",
    )
    parser.add_argument("--label", default="optimized")
    parser.add_argument("--out", default=None)
    parser.add_argument("--quiet", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    # The backend reads the default snapshot mode from the environment; older
    # versions simply ignore the variable.
    os.environ["PWNVIZ_SNAPSHOT_MODE"] = args.mode
    if args.settle is not None:
        os.environ["PWNVIZ_MI_SETTLE_SECONDS"] = str(args.settle)
    report = asyncio.run(run(args))
    output = Path(args.out) if args.out else REPO_ROOT / "docs" / "benchmarks" / (
        f"{args.label}.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print_summary(report)
    print(f"\nreport written to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
