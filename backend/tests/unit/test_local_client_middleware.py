"""The local-only middleware closes the direct-uvicorn bind-guard bypass."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app


async def test_non_loopback_http_client_is_rejected() -> None:
    transport = ASGITransport(app=app, client=("203.0.113.7", 50000))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "non_local_client"


async def test_loopback_http_client_remains_allowed() -> None:
    transport = ASGITransport(app=app, client=("127.0.0.1", 50000))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health")

    assert response.status_code == 200


def test_non_loopback_websocket_is_closed() -> None:
    with TestClient(app, client=("203.0.113.7", 50000)) as client:
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/api/v1/sessions/unknown/stream") as websocket:
                websocket.receive_json()

    assert error.value.code == 4403
