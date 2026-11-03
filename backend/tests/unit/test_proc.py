"""Unit tests for bounded subprocess execution and cleanup."""

from __future__ import annotations

import asyncio
import os
import stat
import time
from pathlib import Path

import pytest

from app.core.proc import run_command


def _script(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "child.sh"
    path.write_text("#!/usr/bin/env bash\n" + body + "\n", encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
    return path


def _process_alive(pid: int) -> bool:
    """True while the PID exists and is not a zombie."""
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


async def test_timeout_marks_result_and_honours_budget(tmp_path: Path) -> None:
    script = _script(tmp_path, "sleep 5")

    result = await run_command([str(script)], timeout=0.3)

    assert result.timed_out is True
    assert result.exit_code is not None
    assert result.duration_ms < 4000


@pytest.mark.skipif(
    os.name != "posix" or not Path("/proc/self/stat").exists(),
    reason="requires POSIX process groups and /proc",
)
async def test_timeout_kills_grandchildren(tmp_path: Path) -> None:
    pid_file = tmp_path / "grandchild.pid"
    script = _script(
        tmp_path,
        f"sleep 30 &\necho $! > {pid_file}\nsleep 30",
    )

    result = await run_command([str(script)], timeout=0.4)

    assert result.timed_out is True
    assert pid_file.exists(), "fake child did not report its grandchild pid"
    pid = int(pid_file.read_text(encoding="utf-8").strip())

    for _ in range(50):
        if not _process_alive(pid):
            break
        time.sleep(0.1)
    assert not _process_alive(pid), f"grandchild {pid} survived process-group kill"


@pytest.mark.skipif(
    os.name != "posix" or not Path("/proc/self/stat").exists(),
    reason="requires POSIX process groups and /proc",
)
async def test_cancellation_kills_probe_process_group(tmp_path: Path) -> None:
    pid_file = tmp_path / "probe.pid"
    script = _script(
        tmp_path,
        f"echo $$ > {pid_file}\nsleep 30",
    )

    task = asyncio.create_task(run_command([str(script)], timeout=30))
    for _ in range(50):
        if pid_file.exists():
            break
        await asyncio.sleep(0.05)
    assert pid_file.exists(), "probe process did not start"
    pid = int(pid_file.read_text(encoding="utf-8").strip())

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    for _ in range(50):
        if not _process_alive(pid):
            break
        await asyncio.sleep(0.1)
    assert not _process_alive(pid), f"probe {pid} survived cancellation cleanup"
