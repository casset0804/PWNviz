"""Byte-level memory diffing between two debugger snapshots."""

from __future__ import annotations

from app.schemas.snapshot import MemoryChange, Snapshot, SnapshotDiff, StackWindow

REGISTER_ORDER = (
    "rip",
    "rsp",
    "rbp",
    "rax",
    "rbx",
    "rcx",
    "rdx",
    "rsi",
    "rdi",
    "r8",
    "r9",
    "r10",
    "r11",
    "r12",
    "r13",
    "r14",
    "r15",
    "eflags",
)


def _ordered(names: list[str]) -> list[str]:
    rank = {name: index for index, name in enumerate(REGISTER_ORDER)}
    return sorted(names, key=lambda name: (rank.get(name, len(rank)), name))


def _byte_map(stack: StackWindow) -> dict[int, str | None]:
    mapping: dict[int, str | None] = {}
    for row in stack.rows:
        try:
            base = int(row.address, 16)
        except (TypeError, ValueError):
            continue
        for index, cell in enumerate(row.bytes):
            mapping[base + index] = cell
    return mapping


class MemoryDiffEngine:
    """Pure comparison: no GDB, no session, easy to unit test."""

    @staticmethod
    def compute(
        previous: Snapshot | None,
        registers: dict[str, str | None],
        stack: StackWindow,
    ) -> SnapshotDiff:
        if previous is None:
            return SnapshotDiff()

        changed_registers: list[str] = []
        for name in _ordered(sorted(set(previous.registers) | set(registers))):
            if previous.registers.get(name) != registers.get(name):
                changed_registers.append(name)

        before_map = _byte_map(previous.stack)
        after_map = _byte_map(stack)
        changed_addresses = sorted(set(before_map) & set(after_map))
        changed_bytes: list[MemoryChange] = []
        for address in changed_addresses:
            before = before_map[address]
            after = after_map[address]
            if before != after:
                changed_bytes.append(
                    MemoryChange(
                        address=f"0x{address:016x}", before=before, after=after
                    )
                )

        window_changed = (
            previous.stack.range_start != stack.range_start
            or previous.stack.range_end != stack.range_end
        )
        return SnapshotDiff(
            previous_snapshot_id=previous.snapshot_id,
            changed_registers=changed_registers,
            changed_bytes=changed_bytes,
            window_changed=window_changed,
        )

    @staticmethod
    def apply_highlights(diff: SnapshotDiff, stack: StackWindow) -> None:
        """Mark which byte cells in the new rows changed, for the UI."""
        changed = {change.address: change for change in diff.changed_bytes}
        for row in stack.rows:
            try:
                base = int(row.address, 16)
            except (TypeError, ValueError):
                continue
            row.changed_byte_offsets = [
                index
                for index in range(len(row.bytes))
                if f"0x{base + index:016x}" in changed
            ]
