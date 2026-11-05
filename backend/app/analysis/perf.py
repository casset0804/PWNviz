"""Monotonic performance instrumentation for one snapshot pipeline.

The goal is *measurement*, not optimisation by omission: every stage reports the
real wall-clock time it spent talking to GDB, and every GDB/MI command is
counted so a fast snapshot can be proven cheaper rather than merely smaller.

All durations come from :func:`time.perf_counter` (a monotonic clock), never
from wall-clock time, so NTP adjustments cannot produce negative deltas.

Overhead per MI command is two ``perf_counter`` calls plus two small dict
updates; per snapshot it is a handful of loops. Nothing here reads GDB memory,
opens files or appends unbounded log history.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Dict, Iterator, List

from app.schemas.snapshot import SnapshotPerf

STAGE_NAMES = (
    "registers",
    "frames",
    "disassembly",
    "memory",
    "variables",
    "diff",
)

# ``command -> (count, total_ms)``. The command name is the first MI token, e.g.
# ``-data-read-memory-bytes``; addresses and variable object names are never
# used as keys, so the mapping stays small and allocation-free in steady state.
CommandTotals = Dict[str, "CommandTotal"]

# Keep the number of independent command keys bounded even if a future caller
# invents commands dynamically.
MAX_COMMAND_KEYS = 48


class CommandTotal:
    """Mutable per-command accumulator (count + monotonic total duration)."""

    __slots__ = ("count", "total_ms")

    def __init__(self) -> None:
        self.count = 0
        self.total_ms = 0.0

    def add(self, duration_ms: float) -> None:
        self.count += 1
        self.total_ms += duration_ms

    def copy(self) -> tuple[int, float]:
        return self.count, self.total_ms


def monotonic_ms() -> float:
    """Current monotonic time in milliseconds."""
    return time.perf_counter() * 1000.0


def command_key(command: str) -> str:
    """First token of an MI command; safe, bounded and address-free."""
    text = command.strip()
    if not text:
        return "?"
    token = text.split(None, 1)[0]
    # ``-var-create``/``-var-list-children`` are distinct commands; ``*`` and
    # GDB variable object names never leak into the key.
    return token[:64]


def round_ms(value: float) -> float:
    """Two decimal places is enough for millisecond-level comparisons."""
    return round(float(value), 3)


class MICounters:
    """Incrementally maintained MI command statistics for one controller.

    The controller owns one instance; collectors snapshot it through
    :meth:`snapshot` before/after each stage to attribute commands exactly.
    """

    __slots__ = ("count", "time_ms", "commands")

    def __init__(self) -> None:
        self.count = 0
        self.time_ms = 0.0
        self.commands: CommandTotals = {}

    def record(self, command: str, duration_ms: float) -> None:
        self.count += 1
        self.time_ms += duration_ms
        key = command_key(command)
        bucket = self.commands.get(key)
        if bucket is None:
            if len(self.commands) >= MAX_COMMAND_KEYS:
                bucket = self.commands.setdefault("other", CommandTotal())
            else:
                bucket = CommandTotal()
                self.commands[key] = bucket
        bucket.add(duration_ms)

    def snapshot(self) -> "MISnapshot":
        return MISnapshot(
            count=self.count,
            time_ms=self.time_ms,
            commands={name: total.copy() for name, total in self.commands.items()},
        )


class MISnapshot:
    """Immutable point-in-time view used to compute per-stage deltas."""

    __slots__ = ("count", "time_ms", "commands")

    def __init__(
        self,
        count: int,
        time_ms: float,
        commands: Dict[str, tuple[int, float]],
    ) -> None:
        self.count = count
        self.time_ms = time_ms
        self.commands = commands

    def delta_counts(self, later: "MISnapshot") -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for name, (count, _total) in later.commands.items():
            earlier = self.commands.get(name)
            difference = count - (earlier[0] if earlier else 0)
            if difference:
                counts[name] = difference
        return counts


class PerfRecorder:
    """Builds one :class:`SnapshotPerf` while the snapshot is collected."""

    def __init__(self, *, snapshot_id: int, mode: str) -> None:
        self.perf = SnapshotPerf(snapshot_id=snapshot_id, mode=mode)
        self._started = monotonic_ms()
        self._baseline: MISnapshot | None = None
        self._stage_baseline: MISnapshot | None = None

    # ------------------------------------------------------------------ timing
    def begin(self, counters: MICounters) -> None:
        self._baseline = counters.snapshot()
        self._started = monotonic_ms()

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        started = monotonic_ms()
        try:
            yield
        finally:
            setattr(self.perf, f"{name}_ms", round_ms(monotonic_ms() - started))

    # ------------------------------------------------------------- attribution
    @contextmanager
    def measure(self, name: str, counters: MICounters) -> Iterator[None]:
        """Time one collection stage and attribute its MI commands.

        Exceptions inside the block are the caller's concern; this only records
        what was spent, so a failing stage still reports its real cost.
        """
        started = monotonic_ms()
        baseline = counters.snapshot()
        try:
            yield
        finally:
            setattr(self.perf, f"{name}_ms", round_ms(monotonic_ms() - started))
            commands = baseline.delta_counts(counters.snapshot())
            self._record_stage_commands(name, commands)

    def _record_stage_commands(self, name: str, commands: Dict[str, int]) -> None:
        total = sum(commands.values())
        if name == "registers":
            self.perf.registers_commands = total
        elif name == "frames":
            self.perf.frames_commands = total
        elif name == "disassembly":
            self.perf.disassembly_commands = total
        elif name == "memory":
            self.perf.stack_read_commands = commands.get(
                "-data-read-memory-bytes", 0
            )
            self.perf.memory_commands = total
        elif name == "variables":
            self.perf.variable_commands = total
        elif name == "diff":
            self.perf.diff_commands = total

    def stage_begin(self, counters: MICounters) -> None:
        """Deprecated single-purpose hook kept for callers that split the work."""
        self._stage_baseline = counters.snapshot()

    def stage_end(self, name: str, counters: MICounters) -> None:
        baseline = self._stage_baseline
        later = counters.snapshot()
        self._stage_baseline = None
        if baseline is None:
            return
        self._record_stage_commands(name, baseline.delta_counts(later))

    # ---------------------------------------------------------------- summary
    def finish(self, counters: MICounters) -> SnapshotPerf:
        baseline = self._baseline
        later = counters.snapshot()
        self.perf.total_ms = round_ms(monotonic_ms() - self._started)
        self.perf.mi_command_count = (
            later.count - baseline.count if baseline is not None else 0
        )
        self.perf.mi_time_ms = round_ms(
            later.time_ms - baseline.time_ms if baseline is not None else 0.0
        )
        for name, (count, total_ms) in later.commands.items():
            earlier = baseline.commands.get(name) if baseline is not None else None
            difference = count - (earlier[0] if earlier else 0)
            if difference:
                self.perf.mi_by_command[name] = difference
                elapsed = total_ms - (earlier[1] if earlier else 0.0)
                self.perf.mi_by_command_ms[name] = round_ms(elapsed)
        return self.perf


def summarise_durations(samples: List[float]) -> Dict[str, float | int]:
    """p50/p95/max/mean for a list of millisecond samples (monotonic measured)."""
    values = sorted(float(value) for value in samples if value is not None)
    if not values:
        return {"count": 0, "min": 0.0, "p50": 0.0, "p95": 0.0, "max": 0.0, "mean": 0.0}

    def percentile(fraction: float) -> float:
        if len(values) == 1:
            return round_ms(values[0])
        position = fraction * (len(values) - 1)
        low = int(position)
        high = min(low + 1, len(values) - 1)
        weight = position - low
        return round_ms(values[low] * (1 - weight) + values[high] * weight)

    return {
        "count": len(values),
        "min": round_ms(values[0]),
        "p50": percentile(0.50),
        "p95": percentile(0.95),
        "max": round_ms(values[-1]),
        "mean": round_ms(sum(values) / len(values)),
    }


__all__ = [
    "CommandTotal",
    "MAX_COMMAND_KEYS",
    "MICounters",
    "MISnapshot",
    "PerfRecorder",
    "STAGE_NAMES",
    "command_key",
    "monotonic_ms",
    "round_ms",
    "summarise_durations",
]
