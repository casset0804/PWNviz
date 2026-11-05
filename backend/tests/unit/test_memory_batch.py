"""Batched stack-memory reads: one request, bounded splitting and safe fallback."""

from __future__ import annotations

from app.collector.common import hex64
from app.collector.memory import StackMemoryCollector
from app.debugger.mi_controller import MICommandError


class ScriptedController:
    """Return scripted responses per request index.

    ``responses`` entries are either ``"ok"``, ``"fail"`` or a callable returning
    a ``(begin_offset, length)`` pair to emulate a partial kernel read.
    """

    def __init__(self, responses: list | None = None) -> None:
        self.commands: list[tuple[int, int]] = []
        self.raw_commands: list[str] = []
        self.responses = responses or []

    async def execute(self, command: str) -> dict:
        parts = command.split()
        assert parts[0] == "-data-read-memory-bytes", command
        address = int(parts[1], 16)
        count = int(parts[2])
        assert str(count).isdigit(), "GDB requires a decimal byte count"
        self.commands.append((address, count))
        self.raw_commands.append(command)
        index = len(self.commands) - 1
        action = self.responses[index] if index < len(self.responses) else "ok"
        if action == "fail":
            raise MICommandError(command, "Unable to read memory.")
        if callable(action):
            begin_offset, length = action(address, count)
        else:
            begin_offset, length = 0, count
        begin = address + begin_offset
        return {
            "type": "result",
            "message": "done",
            "payload": {
                "memory": [
                    {
                        "begin": hex64(begin),
                        "offset": "0x0000000000000000",
                        "end": hex64(begin + length),
                        "contents": "ab" * length,
                    }
                ]
            },
        }


async def test_default_window_is_read_in_one_request(make_settings) -> None:
    settings = make_settings()  # default 0x80 below + 0x180 above = 0x200 bytes
    collector = StackMemoryCollector(settings)
    controller = ScriptedController()

    stack, _warnings = await collector.collect(
        controller, rsp=0x1000, rbp=None, rip=None
    )

    assert len(controller.commands) == 1, controller.raw_commands
    assert controller.commands[0] == (0x1000 - 0x80, 0x200)
    assert collector.last_read_stats.batch_reads == 1
    assert collector.last_read_stats.chunk_reads == 0
    assert collector.last_read_stats.degraded is False
    assert len(stack.rows) == 0x200 // 8
    assert all(row.readable for row in stack.rows)


async def test_window_larger_than_batch_limit_is_split(make_settings) -> None:
    settings = make_settings(
        stack_window_below=0x100,
        stack_window_above=0x300,
        max_stack_read_bytes=0x400,
        memory_batch_max_bytes=0x100,
        memory_chunk_size=0x40,
    )
    collector = StackMemoryCollector(settings)
    controller = ScriptedController()

    stack, _warnings = await collector.collect(
        controller, rsp=0x1000, rbp=None, rip=None
    )

    assert len(controller.commands) == 4, controller.commands
    assert all(count == 0x100 for _address, count in controller.commands)
    assert collector.last_read_stats.batch_reads == 4
    assert collector.last_read_stats.chunk_reads == 0
    assert stack.range_start == hex64(0x1000 - 0x100)
    assert stack.range_end == hex64(0x1000 + 0x300)


async def test_failed_batch_degrades_to_chunk_reads(make_settings) -> None:
    settings = make_settings(
        stack_window_below=0x80,
        stack_window_above=0x180,
        memory_batch_max_bytes=0x200,
        memory_chunk_size=0x40,
    )
    collector = StackMemoryCollector(settings)
    controller = ScriptedController(["fail"])  # first (batch) request fails

    stack, warnings = await collector.collect(
        controller, rsp=0x1000, rbp=None, rip=None
    )

    # One failed batch request, then 8 chunk reads of 0x40 bytes each.
    assert len(controller.commands) == 9
    assert controller.commands[0][1] == 0x200
    assert {count for _address, count in controller.commands[1:]} == {0x40}
    assert collector.last_read_stats.degraded is True
    assert collector.last_read_stats.chunk_reads == 8
    # The fallback recovered every byte, so the address/byte mapping is intact.
    assert all(row.readable for row in stack.rows)
    assert all(row.qword_le == "0x" + "ab" * 8 for row in stack.rows)
    assert stack.unreadable_ranges == []
    # Everything was recovered by the fallback, so no unreadable-byte warning.
    assert warnings == []


async def test_partial_batch_salvages_only_missing_ranges(make_settings) -> None:
    settings = make_settings(
        stack_window_below=0x40,
        stack_window_above=0x80,
        memory_batch_max_bytes=0x100,
        memory_chunk_size=0x40,
    )
    collector = StackMemoryCollector(settings)

    # The batch request returns only the first 0x40 bytes of the 0xc0-byte window.
    def partial(address: int, count: int) -> tuple[int, int]:
        return 0, 0x40

    controller = ScriptedController([partial])

    stack, _warnings = await collector.collect(
        controller, rsp=0x1000, rbp=None, rip=None
    )

    assert collector.last_read_stats.degraded is True
    assert collector.last_read_stats.chunk_reads == 2  # 0x40..0x80, 0x80..0xc0
    assert collector.last_read_stats.bytes_read == 0xC0
    assert all(row.readable for row in stack.rows)
    assert stack.unreadable_ranges == []


async def test_unreadable_batch_and_chunks_stay_unknown(make_settings) -> None:
    settings = make_settings(
        stack_window_below=0x40,
        stack_window_above=0x40,
        memory_batch_max_bytes=0x80,
        memory_chunk_size=0x40,
    )
    collector = StackMemoryCollector(settings)
    controller = ScriptedController(["fail"] + ["fail"] * 8)

    stack, warnings = await collector.collect(
        controller, rsp=0x1000, rbp=None, rip=None
    )

    assert all(not row.readable for row in stack.rows)
    assert all(cell is None for row in stack.rows for cell in row.bytes)
    assert all(row.qword_le is None and row.ascii is None for row in stack.rows)
    assert [range_.start for range_ in stack.unreadable_ranges] == [
        hex64(0x1000 - 0x40)
    ]
    assert any("unreadable" in warning.lower() for warning in warnings)
