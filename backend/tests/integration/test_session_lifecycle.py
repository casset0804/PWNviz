"""Phase 1 acceptance: real GDB session, snapshots, step, diff and cleanup."""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.core.config import get_settings
from app.core.errors import DebuggerError
from app.debugger.environment import pwndbg_candidates
from app.sessions.manager import SessionManager, session_manager
from app.sessions.state import SessionState
from app.schemas.session import CreateSessionRequest

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_DIR = REPO_ROOT / "samples" / "stack-basic"
SOURCE = SAMPLE_DIR / "demo.c"
BINARY = SAMPLE_DIR / "demo"

HEX_RE = re.compile(r"^0x[0-9a-f]{16}$")


@pytest.fixture(scope="module", autouse=True)
def compile_sample() -> None:
    if shutil.which("gcc") is None:
        pytest.skip("gcc is required to compile the teaching sample")
    if not SOURCE.is_file():
        pytest.fail(f"sample source missing: {SOURCE}")
    result = subprocess.run(
        [
            "gcc",
            "-g",
            "-O0",
            "-fno-omit-frame-pointer",
            "-fno-inline",
            "-fno-pie",
            "-no-pie",
            "-o",
            str(BINARY),
            str(SOURCE),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        pytest.fail(f"gcc failed: {result.stderr}")


@pytest.fixture(autouse=True)
async def cleanup_sessions():
    yield
    await session_manager.shutdown()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http


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


async def _wait_pid_gone(pid: int, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _pid_alive(pid):
            return True
        await asyncio.sleep(0.05)
    return not _pid_alive(pid)


async def _create_and_launch(client: AsyncClient) -> tuple[str, dict, dict]:
    created = await client.post(
        "/api/v1/sessions",
        json={"sample_id": "stack-basic", "load_pwndbg": False},
    )
    assert created.status_code == 201, created.text
    session_id = created.json()["session_id"]

    launched = await client.post(f"/api/v1/sessions/{session_id}/launch")
    assert launched.status_code == 200, launched.text
    body = launched.json()
    assert body["state"] == "STOPPED", body
    assert body["snapshot"] is not None, body

    info = (await client.get(f"/api/v1/sessions/{session_id}")).json()
    return session_id, body, info


async def test_step_instruction_produces_real_snapshots(client: AsyncClient) -> None:
    session_id, launch_body, info = await _create_and_launch(client)
    first = launch_body["snapshot"]

    # Structure and truthfulness checks.
    assert first["session_id"] == session_id
    assert first["snapshot_id"] == 1
    assert first["state"] == "STOPPED"
    assert first["architecture"] == "x86-64"
    assert first["endianness"] == "little"
    assert first["pointer_bits"] == 64

    registers = first["registers"]
    for name in ("rip", "rsp", "rbp", "rax"):
        assert name in registers, registers.keys()
        assert registers[name] is not None
        assert HEX_RE.match(registers[name]), (name, registers[name])
    assert len(registers) >= 17

    assert first["frames"], "GDB unwinder returned no frames"
    assert first["frames"][0]["function"] == "main"
    assert HEX_RE.match(first["frames"][0]["address"])

    assert first["instruction"] is not None
    assert first["instruction"]["address"] == registers["rip"]
    assert first["instruction"]["mnemonic"]
    assert any(
        item["is_current"] for item in first["disassembly"]
    ), "current instruction missing from disassembly"

    stack = first["stack"]
    assert HEX_RE.match(stack["range_start"])
    assert HEX_RE.match(stack["range_end"])
    assert stack["word_size"] == 8
    assert stack["rows"], "stack window has no rows"
    assert len(stack["rows"]) * 8 == int(stack["range_end"], 16) - int(
        stack["range_start"], 16
    )
    row = stack["rows"][0]
    assert len(row["bytes"]) == 8
    if row["readable"]:
        assert row["qword_le"] is not None
        assert len(row["qword_le"]) == 18  # 0x + 16 hex digits
    assert first["diff"] == {
        "previous_snapshot_id": None,
        "changed_registers": [],
        "changed_bytes": [],
        "window_changed": False,
    }

    # Step one real machine instruction.
    stepped = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "step_instruction"},
    )
    assert stepped.status_code == 200, stepped.text
    body = stepped.json()
    assert body["state"] == "STOPPED", body
    second = body["snapshot"]
    assert second is not None
    assert second["snapshot_id"] > first["snapshot_id"]
    assert second["registers"]["rip"] != first["registers"]["rip"]
    assert first["instruction"]["bytes"]
    assert int(second["registers"]["rip"], 16) - int(
        first["registers"]["rip"], 16
    ) == len(first["instruction"]["bytes"]) // 2, "RIP must advance by instruction length"
    assert "rip" in second["diff"]["changed_registers"]
    assert second["diff"]["previous_snapshot_id"] == first["snapshot_id"]
    assert second["instruction"]["address"] == second["registers"]["rip"]

    # A single step must not restart GDB: the same process is still serving.
    same_info = (await client.get(f"/api/v1/sessions/{session_id}")).json()
    assert same_info["gdb_pid"] == info["gdb_pid"]

    history = (await client.get(f"/api/v1/sessions/{session_id}/snapshots")).json()
    assert history["count"] >= 2

    gdb_pid = info["gdb_pid"]
    inferior_pid = info["inferior_pid"]
    assert gdb_pid and inferior_pid

    deleted = await client.delete(f"/api/v1/sessions/{session_id}")
    assert deleted.status_code == 204
    assert (await client.get(f"/api/v1/sessions/{session_id}")).status_code == 404
    assert await _wait_pid_gone(gdb_pid)
    assert await _wait_pid_gone(inferior_pid)


async def test_action_before_launch_is_rejected(client: AsyncClient) -> None:
    created = await client.post(
        "/api/v1/sessions",
        json={"sample_id": "stack-basic", "load_pwndbg": False},
    )
    assert created.status_code == 201
    session_id = created.json()["session_id"]

    response = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "step_instruction"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "invalid_session_state"


async def test_continue_to_exit_and_cleanup(client: AsyncClient) -> None:
    session_id, _, info = await _create_and_launch(client)

    continued = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "continue"},
    )
    assert continued.status_code == 200, continued.text

    deadline = time.monotonic() + 10
    state = None
    while time.monotonic() < deadline:
        state = (await client.get(f"/api/v1/sessions/{session_id}")).json()["state"]
        if state == "EXITED":
            break
        await asyncio.sleep(0.05)
    assert state == "EXITED", f"session never exited: {state}"

    gdb_pid = info["gdb_pid"]
    await client.delete(f"/api/v1/sessions/{session_id}")
    assert await _wait_pid_gone(gdb_pid)


async def test_pwndbg_loading_is_optional_and_does_not_block_native_gdb(
    client: AsyncClient,
) -> None:
    if not pwndbg_candidates(get_settings()):
        pytest.skip("pwndbg is not installed on this host")

    created = await client.post(
        "/api/v1/sessions",
        json={"sample_id": "stack-basic", "load_pwndbg": True},
    )
    assert created.status_code == 201
    session_id = created.json()["session_id"]

    launched = await client.post(f"/api/v1/sessions/{session_id}/launch")
    assert launched.status_code == 200, launched.text
    body = launched.json()
    assert body["state"] == "STOPPED"
    assert body["snapshot"] is not None
    # If pwndbg cannot load, the session must still be usable with native GDB.
    warnings = body["snapshot"]["warnings"]
    assert isinstance(warnings, list)

    stepped = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "step_instruction"},
    )
    assert stepped.status_code == 200, stepped.text
    assert stepped.json()["state"] == "STOPPED"

    await client.delete(f"/api/v1/sessions/{session_id}")


async def test_session_limit_is_enforced(client: AsyncClient) -> None:
    limit = get_settings().session_max_active
    created_ids: list[str] = []
    for _ in range(limit):
        response = await client.post(
            "/api/v1/sessions",
            json={"sample_id": "stack-basic", "load_pwndbg": False},
        )
        assert response.status_code == 201, response.text
        created_ids.append(response.json()["session_id"])

    rejected = await client.post(
        "/api/v1/sessions",
        json={"sample_id": "stack-basic", "load_pwndbg": False},
    )
    assert rejected.status_code == 429
    assert rejected.json()["error"]["code"] == "too_many_sessions"

    for session_id in created_ids:
        await client.delete(f"/api/v1/sessions/{session_id}")


async def test_next_actions_produce_stopped_snapshots(client: AsyncClient) -> None:
    session_id, launched, _ = await _create_and_launch(client)
    first_id = launched["snapshot"]["snapshot_id"]

    next_instruction = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "next_instruction"},
    )
    assert next_instruction.status_code == 200, next_instruction.text
    assert next_instruction.json()["state"] == "STOPPED"
    assert next_instruction.json()["snapshot"]["snapshot_id"] > first_id

    source_next = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "next"},
    )
    assert source_next.status_code == 200, source_next.text
    body = source_next.json()
    assert body["state"] == "STOPPED"
    assert body["snapshot"]["snapshot_id"] > first_id
    assert body["snapshot"]["frames"][0]["line"] >= 10

    await client.delete(f"/api/v1/sessions/{session_id}")


async def test_delete_running_session_cleans_up_processes(client: AsyncClient) -> None:
    session_id, _, info = await _create_and_launch(client)
    continued = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "continue"},
    )
    assert continued.status_code == 200, continued.text

    deleted = await client.delete(f"/api/v1/sessions/{session_id}")
    assert deleted.status_code == 204
    assert await _wait_pid_gone(info["gdb_pid"])
    assert await _wait_pid_gone(info["inferior_pid"])


async def test_step_into_function_then_finish(client: AsyncClient) -> None:
    session_id, _, _ = await _create_and_launch(client)
    entered = False
    for _ in range(24):
        stepped = await client.post(
            f"/api/v1/sessions/{session_id}/actions",
            json={"action": "step_instruction"},
        )
        assert stepped.status_code == 200, stepped.text
        snapshot = stepped.json()["snapshot"]
        assert snapshot is not None
        if snapshot["frames"] and snapshot["frames"][0]["function"] == "add_numbers":
            entered = True
            break
    assert entered, "stepping never entered add_numbers"

    finished = await client.post(
        f"/api/v1/sessions/{session_id}/actions",
        json={"action": "finish"},
    )
    assert finished.status_code == 200, finished.text
    body = finished.json()
    assert body["state"] == "STOPPED"
    assert body["snapshot"] is not None
    assert body["snapshot"]["frames"][0]["function"] == "main"
    assert body["snapshot"]["snapshot_id"] > 1

    await client.delete(f"/api/v1/sessions/{session_id}")


async def test_launch_failure_sets_error_without_leaking(
    make_settings,
) -> None:
    settings = make_settings(
        samples_dir=REPO_ROOT / "samples",
        allowed_sample_dir=REPO_ROOT / "samples",
        gdb_binary="pwnviz-definitely-missing-gdb",
    )
    manager = SessionManager()
    session = await manager.create(
        CreateSessionRequest(sample_id="stack-basic", load_pwndbg=False),
        settings,
    )

    with pytest.raises(DebuggerError):
        await session.launch()

    assert session.state is SessionState.ERROR
    assert session.controller is None
    assert session.last_error
    await manager.shutdown()
