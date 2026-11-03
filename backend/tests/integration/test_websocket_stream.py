"""Real WebSocket stream test: initial state + snapshot and live push."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[3]
BINARY = REPO_ROOT / "samples" / "stack-basic" / "demo"


@pytest.mark.skipif(shutil.which("gdb") is None, reason="GDB not installed")
def test_websocket_streams_state_and_snapshot() -> None:
    if not BINARY.is_file():
        pytest.skip("sample binary not built")

    with TestClient(app) as client:
        created = client.post(
            "/api/v1/sessions",
            json={"sample_id": "stack-basic", "load_pwndbg": False},
        )
        assert created.status_code == 201, created.text
        session_id = created.json()["session_id"]

        launched = client.post(f"/api/v1/sessions/{session_id}/launch")
        assert launched.status_code == 200, launched.text
        first_snapshot_id = launched.json()["snapshot"]["snapshot_id"]

        with client.websocket_connect(
            f"/api/v1/sessions/{session_id}/stream"
        ) as websocket:
            first = websocket.receive_json()
            second = websocket.receive_json()
            assert first["type"] == "session.state"
            assert first["session_id"] == session_id
            assert first["payload"]["state"] == "STOPPED"
            assert second["type"] == "snapshot"
            assert second["payload"]["snapshot_id"] == first_snapshot_id

            stepped = client.post(
                f"/api/v1/sessions/{session_id}/actions",
                json={"action": "step_instruction"},
            )
            assert stepped.status_code == 200, stepped.text

            events: list[dict] = []
            for _ in range(20):
                event = websocket.receive_json()
                events.append(event)
                if (
                    event["type"] == "snapshot"
                    and event["payload"]["snapshot_id"] > first_snapshot_id
                ):
                    break
            assert any(
                event["type"] == "session.state"
                and event["payload"]["state"] == "STOPPED"
                for event in events
            ), events
            snapshots = [
                event for event in events if event["type"] == "snapshot"
            ]
            assert snapshots, events
            assert snapshots[-1]["payload"]["snapshot_id"] > first_snapshot_id

        deleted = client.delete(f"/api/v1/sessions/{session_id}")
        assert deleted.status_code == 204


@pytest.mark.skipif(shutil.which("gdb") is None, reason="GDB not installed")
def test_websocket_rejects_foreign_origin() -> None:
    if not BINARY.is_file():
        pytest.skip("sample binary not built")

    with TestClient(app) as client:
        created = client.post(
            "/api/v1/sessions",
            json={"sample_id": "stack-basic", "load_pwndbg": False},
        )
        assert created.status_code == 201
        session_id = created.json()["session_id"]

        with client.websocket_connect(
            f"/api/v1/sessions/{session_id}/stream",
            headers={"origin": "http://evil.example"},
        ) as websocket:
            with pytest.raises(WebSocketDisconnect):
                websocket.receive_json()

        client.delete(f"/api/v1/sessions/{session_id}")


def test_websocket_unknown_session_is_closed() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/sessions/sess_does_not_exist/stream"
        ) as websocket:
            with pytest.raises(WebSocketDisconnect):
                websocket.receive_json()
