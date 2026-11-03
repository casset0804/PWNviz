"""Failure-path tests for MI reader failure and orphan inferior cleanup."""

from __future__ import annotations

import asyncio
import subprocess

import pytest

from app.core.config import get_settings
from app.debugger.gdb_process import GdbProcessError
from app.debugger.mi_controller import Epochs, MIController, MIError


class FakeGdbProcess:
    """Minimal process/IoManager stand-in used only to simulate reader failure."""

    def __init__(self) -> None:
        self.pid = 4242
        self.alive = True
        self.fail_reads = False
        self._results: list[dict] = []
        self.closed = False

    def start(self) -> int:
        return self.pid

    def write(self, text: str) -> None:
        digits = ""
        for character in text:
            if character.isdigit():
                digits += character
            else:
                break
        self._results.append(
            {
                "type": "result",
                "message": "done",
                "payload": None,
                "token": int(digits) if digits else None,
            }
        )

    def read(self, timeout: float = 0.2) -> list[dict]:
        if self.fail_reads:
            raise GdbProcessError("simulated broken MI pipe")
        if self._results:
            return [self._results.pop(0)]
        return []

    def wait_exit(self, timeout: float) -> bool:
        return True

    def close(self, *, timeout: float = 3.0) -> None:
        self.closed = True
        self.alive = False


async def test_reader_failure_marks_controller_fatal_and_wakes_waiters() -> None:
    fake = FakeGdbProcess()
    controller = MIController(get_settings(), gdb_process=fake)  # type: ignore[arg-type]
    await controller.start()
    try:
        fake.fail_reads = True

        event = await asyncio.wait_for(controller.next_event(), timeout=3)
        assert event["type"] == "error"
        assert "broken MI pipe" in event["message"]

        with pytest.raises(MIError):
            await controller.wait_for_stop(Epochs(stop=0, exit=0), timeout=1)
    finally:
        await controller.close()

    assert fake.closed is True


class DeadGdbProcess:
    pid = None
    alive = False

    def close(self, *, timeout: float = 3.0) -> None:
        return None


async def test_orphan_inferior_is_killed_when_starttime_matches() -> None:
    inferior = subprocess.Popen(["sleep", "30"])
    try:
        controller = MIController(
            get_settings(), gdb_process=DeadGdbProcess()  # type: ignore[arg-type]
        )
        controller.inferior_pid = inferior.pid
        controller._inferior_starttime = MIController._proc_starttime(inferior.pid)
        assert controller._inferior_starttime is not None

        await controller.close()

        inferior.wait(timeout=3)
        assert inferior.returncode is not None
    finally:
        if inferior.poll() is None:
            inferior.kill()
            inferior.wait(timeout=3)
