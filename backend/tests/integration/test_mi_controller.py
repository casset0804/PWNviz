"""Real GDB/MI controller tests: timeouts must not kill the reader."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.debugger.mi_controller import MIController, MICommandError, MICommandTimeout

pytestmark = pytest.mark.integration


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        stat_line = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    except OSError:
        return False
    fields = stat_line.rsplit(")", 1)[-1].split()
    return bool(fields) and fields[0] != "Z"


@pytest.mark.skipif(shutil.which("gdb") is None, reason="GDB not installed")
async def test_command_timeout_does_not_kill_reader_or_lose_later_commands() -> None:
    controller = MIController(get_settings())
    await controller.start()
    gdb_pid = controller.pid
    assert gdb_pid
    try:
        # GDB blocks inside Python for 0.6s before answering this command.
        with pytest.raises(MICommandTimeout):
            await controller.execute(
                '-interpreter-exec console "python import time; time.sleep(0.6)"',
                timeout=0.05,
            )

        # The reader must still be alive after the command future was abandoned.
        await asyncio.sleep(0.8)
        record = await controller.execute("-gdb-set confirm off", timeout=5)
        assert record["type"] == "result"
        assert record["message"] == "done"
        assert record.get("token") is not None

        # A normal invalid command reports ^error without killing the controller.
        with pytest.raises(MICommandError):
            await controller.execute("-data-read-memory-bytes 0x0 8", timeout=5)
        ok = await controller.execute("-gdb-set pagination off", timeout=5)
        assert ok["message"] == "done"
    finally:
        await controller.close()

    for _ in range(30):
        if not _pid_alive(gdb_pid):
            break
        await asyncio.sleep(0.1)
    assert not _pid_alive(gdb_pid), "GDB process leaked after controller close"


@pytest.mark.skipif(
    shutil.which("gdb") is None or shutil.which("gcc") is None,
    reason="GDB and GCC are required",
)
async def test_interrupt_stops_a_running_inferior(tmp_path: Path) -> None:
    source = tmp_path / "slow.c"
    binary = tmp_path / "slow"
    source.write_text(
        "#include <unistd.h>\nint main(void) { sleep(30); return 0; }\n",
        encoding="utf-8",
    )
    compiled = subprocess.run(
        [
            "gcc",
            "-g",
            "-O0",
            "-fno-pie",
            "-no-pie",
            "-o",
            str(binary),
            str(source),
        ],
        capture_output=True,
        text=True,
    )
    assert compiled.returncode == 0, compiled.stderr

    controller = MIController(get_settings())
    await controller.start()
    gdb_pid = controller.pid
    try:
        await controller.execute(
            f'-file-exec-and-symbols "{binary}"', timeout=10
        )
        await controller.execute("-break-insert main", timeout=10)
        run_epochs = controller.epochs()
        await controller.execute("-exec-run", timeout=10)
        first_stop = await controller.wait_for_stop(run_epochs, timeout=10)
        assert first_stop.reason == "breakpoint-hit"

        stop_epochs = controller.epochs()
        await controller.execute("-exec-continue", timeout=10)
        await asyncio.sleep(0.3)
        await controller.execute("-exec-interrupt", timeout=10)
        stopped = await controller.wait_for_stop(stop_epochs, timeout=10)
        assert stopped.reason is not None
        assert controller.state == "stopped"
    finally:
        await controller.close()

    assert gdb_pid
    for _ in range(50):
        if not _pid_alive(gdb_pid):
            break
        await asyncio.sleep(0.1)
    assert not _pid_alive(gdb_pid), "interrupted session leaked GDB"
