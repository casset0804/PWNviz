"""Unit tests for byte-level diffing and stack window math (no GDB)."""

from __future__ import annotations

from app.analysis.diff import MemoryDiffEngine
from app.collector.common import hex64
from app.collector.memory import compute_window
from app.schemas.snapshot import Snapshot, StackRow, StackWindow


def _row(address: int, cells: list[str | None]) -> StackRow:
    return StackRow(
        address=hex64(address),
        bytes=cells,
        readable=all(cell is not None for cell in cells),
        qword_le=None,
        ascii=None,
    )


def _snapshot(
    snapshot_id: int,
    registers: dict[str, str | None],
    rows: list[StackRow],
    start: int,
    end: int,
) -> Snapshot:
    return Snapshot(
        session_id="sess_test",
        snapshot_id=snapshot_id,
        timestamp="2026-11-03T00:00:00Z",
        state="STOPPED",
        architecture="x86-64",
        registers=registers,
        stack=StackWindow(
            range_start=hex64(start),
            range_end=hex64(end),
            rows=rows,
        ),
    )


def test_first_snapshot_has_empty_diff() -> None:
    stack = StackWindow()
    diff = MemoryDiffEngine.compute(None, {"rip": hex64(0x401000)}, stack)

    assert diff.previous_snapshot_id is None
    assert diff.changed_registers == []
    assert diff.changed_bytes == []


def test_changed_bytes_compare_by_address_not_row_index() -> None:
    base = 0x7FFFFFFFE000
    previous = _snapshot(
        1,
        {"rip": hex64(0x401000)},
        [
            _row(base, ["00"] * 8),
            _row(base + 8, ["00"] * 8),
        ],
        base,
        base + 16,
    )
    current = _snapshot(
        2,
        {"rip": hex64(0x401001)},
        [
            # Window shifted down by 8: the second row starts at base.
            _row(base - 8, ["00"] * 8),
            _row(base, ["aa"] + ["00"] * 7),
        ],
        base - 8,
        base + 8,
    )

    diff = MemoryDiffEngine.compute(previous, current.registers, current.stack)

    assert diff.previous_snapshot_id == 1
    assert diff.changed_registers == ["rip"]
    assert diff.window_changed is True
    [change] = diff.changed_bytes
    assert change.address == hex64(base)
    assert change.before == "00"
    assert change.after == "aa"

    MemoryDiffEngine.apply_highlights(diff, current.stack)
    assert current.stack.rows[1].changed_byte_offsets == [0]


def test_unreadable_byte_transition_is_a_change() -> None:
    base = 0x7FFFFFFFE100
    previous = _snapshot(1, {}, [_row(base, ["11"] * 8)], base, base + 8)
    current = _snapshot(2, {}, [_row(base, [None, "11", "11", "11", "11", "11", "11", "11"])], base, base + 8)

    diff = MemoryDiffEngine.compute(previous, current.registers, current.stack)

    [change] = diff.changed_bytes
    assert change.address == hex64(base)
    assert change.before == "11"
    assert change.after is None


def test_compute_window_is_aligned_and_capped() -> None:
    rsp = 0x7FFFFFFFE280
    start, end = compute_window(rsp, below=0x80, above=0x180, max_bytes=0x400)

    assert start == rsp - 0x80
    assert end == rsp + 0x180
    assert start % 8 == 0 and end % 8 == 0

    capped_start, capped_end = compute_window(
        rsp, below=0x80, above=0x1000, max_bytes=0x200
    )
    assert capped_end - capped_start == 0x200
    assert capped_end > rsp


def test_compute_window_near_zero_does_not_go_negative() -> None:
    start, end = compute_window(0x10, below=0x100, above=0x100, max_bytes=0x400)

    assert start == 0
    assert end >= 0x110
