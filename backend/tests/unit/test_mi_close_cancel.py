"""Cancelling controller shutdown must still kill and close the GDB process."""

from __future__ import annotations

import asyncio
import time

import pytest

from app.debugger.mi_controller import MIController


class SlowExitGdb:
    def __init__(self) -> None:
        self.alive = True
        self.killed = False
        self.closed = False
        self.writes: list[str] = []

    @property
    def pid(self) -> int | None:
        return 4242

    def write(self, text: str) -> None:
        self.writes.append(text)

    def wait_exit(self, timeout: float) -> bool:
        time.sleep(0.5)
        self.alive = False
        return True

    def kill(self) -> None:
        self.killed = True
        self.alive = False

    def close(self) -> None:
        self.closed = True
        self.alive = False


async def test_cancelled_close_still_releases_process(make_settings) -> None:
    gdb = SlowExitGdb()
    controller = MIController(make_settings(), gdb_process=gdb)

    task = asyncio.create_task(controller.close())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert gdb.killed is True
    assert gdb.closed is True
    assert controller.state == "unknown"
