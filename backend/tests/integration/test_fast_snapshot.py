"""V1.1 fast/full snapshot behaviour against a real GDB process.

These tests deliberately assert *measured* facts:

* a fast step still reports the real register change and a byte-level diff that
  matches the byte actually present in the new snapshot;
* fast steps reuse cached frames/disassembly and refresh variable objects with
  ``-var-update`` instead of recreating them;
* a frame change destroys the old variable objects and rebuilds the tree;
* the disassembly window is re-fetched exactly when RIP leaves it;
* the stack window is read in one batched MI command;
* the published snapshot carries serialization/payload measurements.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from app.schemas.session import CreateSessionRequest
from app.schemas.snapshot import Snapshot
from app.sessions.manager import SessionManager, session_manager
from app.sessions.state import SessionState

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_DIR = REPO_ROOT / "samples" / "stack-basic"
SOURCE = SAMPLE_DIR / "demo.c"
BINARY = SAMPLE_DIR / "demo"


@pytest.fixture(scope="module", autouse=True)
def compile_sample() -> None:
    if shutil.which("gcc") is None:
        pytest.skip("gcc is required to compile the teaching sample")
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
    if result.returncode != 0 or not BINARY.is_file():
        pytest.fail(f"gcc failed: {result.stderr}")


@pytest.fixture(autouse=True)
async def cleanup_sessions():
    yield
    await session_manager.shutdown()


def _byte_at(snapshot: Snapshot, address: str) -> str | None:
    """Read one byte from the snapshot's stack rows, or None if unreadable."""
    target = int(address, 16)
    for row in snapshot.stack.rows:
        start = int(row.address, 16)
        if start <= target < start + 8:
            return row.bytes[target - start]
    return None


async def _launch() -> tuple[SessionManager, object, Snapshot]:
    manager = SessionManager()
    session = await manager.create(
        CreateSessionRequest(sample_id="stack-basic", load_pwndbg=False)
    )
    snapshot = await session.launch()
    assert snapshot is not None, "launch produced no snapshot"
    return manager, session, snapshot


async def test_launch_unwinds_past_main_for_the_stack_map() -> None:
    """GDB's default `backtrace past-main off` must be overridden.

    Without it the launch snapshot only contains `main`, so the graphical stack
    map cannot cross-check main's frame boundary against the libc caller.
    """
    manager, session, first = await _launch()
    try:
        assert first.frames[0].function == "main"
        assert len(first.frames) >= 3, [frame.function for frame in first.frames]
        assert any(
            "libc" in (frame.function or "").lower() for frame in first.frames[1:]
        ), [frame.function for frame in first.frames]
    finally:
        await manager.shutdown()


async def test_single_step_reports_real_register_and_byte_diff() -> None:
    manager, session, first = await _launch()
    try:
        assert first.mode == "full"
        assert first.perf is not None
        assert first.perf.mi_command_count > 0
        assert first.perf.total_ms > 0

        state, snapshot = await session.action("step_instruction")
        assert state is SessionState.STOPPED
        assert snapshot is not None
        assert snapshot.mode == "fast"
        assert snapshot.registers["rip"] != first.registers["rip"]
        assert "rip" in snapshot.diff.changed_registers

        # Walk until an instruction really wrote memory, then prove that the
        # reported diff matches the byte inside the new snapshot at that address.
        found = False
        window_start = int(snapshot.stack.range_start, 16)
        window_end = int(snapshot.stack.range_end, 16)
        for _ in range(30):
            if snapshot.diff.changed_bytes:
                change = snapshot.diff.changed_bytes[0]
                address = int(change.address, 16)
                assert window_start <= address < window_end
                assert change.before != change.after
                assert _byte_at(snapshot, change.address) == change.after
                found = True
                break
            state, snapshot = await session.action("step_instruction")
            if state is not SessionState.STOPPED or snapshot is None:
                break
        assert found, "no instruction in 30 steps produced a byte diff"
    finally:
        await manager.shutdown()


async def test_fast_step_reuses_caches_and_keeps_truthful_variables() -> None:
    manager, session, first = await _launch()
    try:
        assert first.variables_state == "full"
        assert first.variables_available is True

        state, snapshot = await session.action("step_instruction")
        assert state is SessionState.STOPPED
        assert snapshot is not None
        perf = snapshot.perf
        assert perf is not None
        assert perf.mode == "fast"

        # Frames and disassembly are served from cache; no rebuild commands.
        assert perf.frames_state == "cached"
        assert snapshot.frames_stale is True
        assert "-stack-list-frames" not in perf.mi_by_command
        assert perf.disassembly_source == "cache"
        assert "-data-disassemble" not in perf.mi_by_command

        # Variables are current, refreshed in place instead of rebuilt.
        assert snapshot.variables_state in {"updated", "cached"}
        assert "-var-create" not in perf.mi_by_command
        assert perf.mi_command_count <= 8, perf.mi_by_command
        assert perf.stack_read_commands == 1
        assert perf.memory_batch_reads >= 1
        assert perf.memory_chunk_reads == 0
    finally:
        await manager.shutdown()


async def test_full_refresh_reads_locals_and_marks_variables_full() -> None:
    manager, session, first = await _launch()
    try:
        assert first.variables_available is True
        assert all(
            node.source == "dwarf" and node.confidence == "debug-info"
            for node in first.variables
        )
        state, stepped = await session.action("step_instruction")
        assert state is SessionState.STOPPED and stepped is not None

        refreshed = await session.refresh(mode="full")
        assert refreshed.snapshot_id > stepped.snapshot_id
        assert refreshed.variables_state == "full"
        assert refreshed.variables_version == refreshed.snapshot_id
        assert refreshed.frames_state == "fresh"
        assert refreshed.perf is not None
        assert refreshed.perf.mi_by_command.get("-var-update", 0) >= 1
        # An explicit refresh is also published, so serialization is measured.
        assert refreshed.perf.serialize_ms is not None
        assert refreshed.perf.payload_bytes > 0
    finally:
        await manager.shutdown()


async def test_variable_objects_are_reused_and_destroyed_on_frame_change() -> None:
    manager, session, first = await _launch()
    try:
        # Same frame: cached varobjs are updated, never recreated.
        state, stepped = await session.action("step_instruction")
        assert state is SessionState.STOPPED and stepped is not None
        assert "-var-create" not in stepped.perf.mi_by_command

        # Step into add_numbers: the frame changes, so old varobjs must go away
        # and the new frame's variables must be rebuilt.
        entered = None
        for _ in range(30):
            state, snapshot = await session.action("step_instruction")
            if state is not SessionState.STOPPED or snapshot is None:
                break
            if snapshot.frames and snapshot.frames[0].function == "add_numbers":
                entered = snapshot
                break
        assert entered is not None, "stepping never entered add_numbers"
        assert entered.variables_state == "full"
        assert "-var-create" in entered.perf.mi_by_command
        assert "-var-delete" in entered.perf.mi_by_command
        names = {node.name for node in entered.variables}
        assert names & {"x", "y", "sum"}, names
        assert all(node.frame_level == 0 for node in entered.variables)

        # Returning to main rebuilds again (new frame instance).
        state, returned = await session.action("finish")
        assert state is SessionState.STOPPED and returned is not None
        assert returned.frames[0].function == "main"
        assert returned.variables_state == "full"
    finally:
        await manager.shutdown()


async def test_disassembly_cache_invalidates_when_rip_leaves_window() -> None:
    manager, session, first = await _launch()
    try:
        saw_cache = False
        saw_fetch = False
        for _ in range(40):
            state, snapshot = await session.action("step_instruction")
            if state is not SessionState.STOPPED or snapshot is None:
                break
            perf = snapshot.perf
            assert perf is not None
            if perf.disassembly_source == "cache":
                saw_cache = True
                assert "-data-disassemble" not in perf.mi_by_command
            elif perf.disassembly_source == "gdb":
                saw_fetch = True
                assert "-data-disassemble" in perf.mi_by_command
                assert perf.disassembly_version == snapshot.snapshot_id
                assert snapshot.instruction is not None
                assert snapshot.instruction.address == snapshot.registers["rip"]
        assert saw_cache, "no step reused the cached disassembly window"
        assert saw_fetch, "RIP never left the cached window"
    finally:
        await manager.shutdown()


async def test_stack_window_is_read_in_one_batched_request() -> None:
    manager, session, first = await _launch()
    try:
        perf = first.perf
        assert perf is not None
        assert perf.stack_read_commands == 1
        assert perf.memory_batch_reads >= 1
        assert perf.memory_chunk_reads == 0
        start = int(first.stack.range_start, 16)
        end = int(first.stack.range_end, 16)
        assert end - start == 0x200, "default RSP window changed"
        assert len(first.stack.rows) * 8 == end - start
        assert all(row.readable for row in first.stack.rows)
        assert first.stack.unreadable_ranges == []
    finally:
        await manager.shutdown()


@pytest.fixture
async def async_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http


async def test_rest_performance_and_refresh_endpoints(async_client: AsyncClient) -> None:
    created = await async_client.post(
        "/api/v1/sessions",
        json={"sample_id": "stack-basic", "load_pwndbg": False},
    )
    assert created.status_code == 201, created.text
    session_id = created.json()["session_id"]
    try:
        launched = await async_client.post(f"/api/v1/sessions/{session_id}/launch")
        assert launched.status_code == 200, launched.text
        payload = launched.json()["snapshot"]
        assert payload["mode"] == "full"
        assert payload["perf"]["mi_command_count"] > 0
        assert payload["perf"]["payload_bytes"] > 0
        assert payload["perf"]["serialize_ms"] is not None

        stepped = await async_client.post(
            f"/api/v1/sessions/{session_id}/actions",
            json={"action": "step_instruction"},
        )
        assert stepped.status_code == 200, stepped.text
        assert stepped.json()["snapshot"]["mode"] == "fast"

        report = await async_client.get(
            f"/api/v1/sessions/{session_id}/performance"
        )
        assert report.status_code == 200, report.text
        body = report.json()
        assert body["last"] is not None
        assert body["samples"] >= 2
        assert body["aggregate"]["total_ms"]["count"] >= 2
        assert body["aggregate"]["mi_command_count"]["p50"] > 0
        assert body["recent"], body

        refreshed = await async_client.post(
            f"/api/v1/sessions/{session_id}/refresh", json={"mode": "full"}
        )
        assert refreshed.status_code == 200, refreshed.text
        snapshot = refreshed.json()["snapshot"]
        assert snapshot["variables_state"] == "full"
        assert snapshot["frames_state"] == "fresh"
        # An explicit refresh never claims to have executed an instruction.
        assert snapshot["snapshot_id"] > stepped.json()["snapshot"]["snapshot_id"]
    finally:
        await async_client.delete(f"/api/v1/sessions/{session_id}")
