"""Unit tests for explicitly represented unreadable stack memory."""

from __future__ import annotations

from app.collector.common import hex64
from app.collector.memory import StackMemoryCollector
from app.debugger.mi_controller import MICommandError


class FakeController:
    """Only the MI command surface used by the stack collector."""

    def __init__(self, fail_after: int | None = None) -> None:
        self.commands: list[str] = []
        self.fail_after = fail_after

    async def execute(self, command: str) -> dict:
        self.commands.append(command)
        parts = command.split()
        address = int(parts[1], 16)
        count = int(parts[2])
        if self.fail_after is not None and len(self.commands) > self.fail_after:
            raise MICommandError(command, "Unable to read memory.")
        return {
            "type": "result",
            "message": "done",
            "payload": {
                "memory": [
                    {
                        "begin": hex64(address),
                        "offset": "0x0000000000000000",
                        "end": hex64(address + count),
                        "contents": "00" * count,
                    }
                ]
            },
        }


async def test_all_unreadable_bytes_are_null_not_zero(make_settings) -> None:
    settings = make_settings(
        stack_window_below=8,
        stack_window_above=8,
        memory_chunk_size=8,
        max_stack_read_bytes=0x40,
    )
    collector = StackMemoryCollector(settings)
    controller = FakeController(fail_after=0)

    stack, warnings = await collector.collect(
        controller, rsp=0x1000, rbp=None, rip=None
    )

    assert len(stack.rows) == 2
    assert all(row.readable is False for row in stack.rows)
    assert all(cell is None for row in stack.rows for cell in row.bytes)
    assert all(row.qword_le is None and row.ascii is None for row in stack.rows)
    assert stack.unreadable_ranges
    assert stack.unreadable_ranges[0].start == hex64(0xFF8)
    assert stack.unreadable_ranges[0].end == hex64(0x1008)
    assert warnings
    # GDB requires the byte count as decimal; hex counts fail with "Unable to read memory".
    assert all(command.split()[-1].isdigit() for command in controller.commands)


async def test_partially_readable_window_keeps_known_bytes(make_settings) -> None:
    settings = make_settings(
        stack_window_below=8,
        stack_window_above=8,
        memory_chunk_size=8,
        max_stack_read_bytes=0x40,
    )
    collector = StackMemoryCollector(settings)
    controller = FakeController(fail_after=1)

    stack, warnings = await collector.collect(
        controller, rsp=0x1000, rbp=None, rip=None
    )

    assert len(stack.rows) == 2
    assert stack.rows[0].readable is True
    assert stack.rows[0].bytes == ["00"] * 8
    assert stack.rows[1].readable is False
    assert stack.rows[1].bytes == [None] * 8
    assert stack.unreadable_ranges
    assert stack.unreadable_ranges[0].start == hex64(0x1000)
    assert stack.unreadable_ranges[0].end == hex64(0x1008)
    assert any("unreadable" in warning.lower() for warning in warnings)
