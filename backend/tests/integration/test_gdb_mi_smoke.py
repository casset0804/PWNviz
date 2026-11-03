"""Real GDB/MI3 integration test for the debugger substrate.

This does not mock GDB and does not test a product session API (Phase 1 has not
been implemented yet). It proves the host can load the teaching ELF, stop at
``main``, execute one real machine instruction, read a register and memory over
MI3, and leave no inferior process behind.
"""

from __future__ import annotations

import os
import re
import shutil
import time
from pathlib import Path
from typing import Any

import pytest
from pygdbmi.gdbcontroller import GdbController

from app.core.config import get_settings

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[3]
BINARY = REPO_ROOT / "samples" / "stack-basic" / "demo"


def _find_stop(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    for record in records:
        if record.get("type") == "notify" and record.get("message") == "stopped":
            return record
    return None


def _await_stop(
    controller: GdbController,
    initial: list[dict[str, Any]],
    *,
    timeout: float = 10.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    record = _find_stop(initial)
    if record is not None:
        return record
    while time.monotonic() < deadline:
        records = controller.get_gdb_response(
            timeout_sec=1, raise_error_on_timeout=False
        )
        record = _find_stop(records)
        if record is not None:
            return record
        if any(
            item.get("type") == "result" and item.get("message") == "error"
            for item in records
        ):
            break
    raise AssertionError("GDB did not report a *stopped event within the deadline")


def _command_value(controller: GdbController, command: str) -> str:
    records = controller.write(command, timeout_sec=10)
    for record in records:
        if record.get("type") == "result" and record.get("message") == "done":
            payload = record.get("payload") or {}
            value = payload.get("value")
            if isinstance(value, str):
                return value
    raise AssertionError(f"no ^done value for {command!r}: {records}")


def _inferior_pid(records: list[dict[str, Any]]) -> int | None:
    for record in records:
        if record.get("type") == "notify" and record.get("message") == "thread-group-started":
            payload = record.get("payload") or {}
            try:
                return int(str(payload.get("pid")))
            except (TypeError, ValueError):
                return None
    return None


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


@pytest.mark.skipif(shutil.which("gdb") is None, reason="GDB not installed on host")
def test_real_mi_break_run_step_memory_and_cleanup() -> None:
    if not BINARY.is_file():
        pytest.skip(f"sample binary missing: {BINARY}")

    gdb = get_settings().gdb_binary
    if shutil.which(gdb) is None and not Path(gdb).is_file():
        pytest.skip(f"configured GDB not available: {gdb}")

    controller = GdbController(
        command=[gdb, "--quiet", "--nx", "--interpreter=mi3"],
        time_to_check_for_additional_output_sec=0.2,
    )
    inferior_pid: int | None = None
    exited = False

    try:
        load = controller.write(
            f"-file-exec-and-symbols {BINARY}", timeout_sec=10
        )
        assert any(
            record.get("type") == "result" and record.get("message") == "done"
            for record in load
        ), f"target load failed: {load}"

        breakpoint = controller.write("-break-insert main", timeout_sec=10)
        assert any(
            record.get("type") == "result" and record.get("message") == "done"
            for record in breakpoint
        ), f"breakpoint insert failed: {breakpoint}"

        run_records = controller.write("-exec-run", timeout_sec=10)
        inferior_pid = _inferior_pid(run_records)
        stop = _await_stop(controller, run_records)
        reason = (stop.get("payload") or {}).get("reason", "")
        assert reason == "breakpoint-hit", f"unexpected stop reason: {reason!r}"

        rip_before_value = _command_value(controller, "-data-evaluate-expression $rip")
        rip_before = int(rip_before_value.split()[0], 16)

        step_records = controller.write("-exec-step-instruction", timeout_sec=10)
        _await_stop(controller, step_records)

        rip_after_value = _command_value(controller, "-data-evaluate-expression $rip")
        rsp_value = _command_value(controller, "-data-evaluate-expression $rsp")
        rip_after = int(rip_after_value.split()[0], 16)
        rsp = int(rsp_value.split()[0], 16)

        assert re.fullmatch(r"0x[0-9a-fA-F]+", rip_after_value.split()[0])
        assert rip_after != rip_before, "single step did not advance RIP"
        assert str(rsp_value.split()[0]).startswith("0x")

        memory_records = controller.write(
            "-data-read-memory-bytes $rsp 8", timeout_sec=10
        )
        memory_payload = None
        for record in memory_records:
            if record.get("type") == "result" and record.get("message") == "done":
                memory_payload = record.get("payload") or {}
        assert memory_payload, f"memory read failed: {memory_records}"
        [block] = memory_payload["memory"]
        contents = block["contents"]
        assert re.fullmatch(r"[0-9a-fA-F]{16}", contents), contents
        assert int(block["begin"], 16) == rsp
        assert int(block["end"], 16) == rsp + 8

        controller.write("-gdb-exit", timeout_sec=5, read_response=False)
        controller.exit()
        exited = True
    finally:
        if not exited:
            try:
                controller.write("-gdb-exit", timeout_sec=5, read_response=False)
            except Exception:  # noqa: BLE001 - best-effort teardown
                pass
            try:
                controller.exit()
            except Exception:  # noqa: BLE001 - best-effort teardown
                pass

    if inferior_pid is not None:
        for _ in range(30):
            if not _pid_alive(inferior_pid):
                break
            time.sleep(0.1)
        assert not _pid_alive(inferior_pid), (
            f"inferior process {inferior_pid} survived GDB exit"
        )
