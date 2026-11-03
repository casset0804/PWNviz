"""WebSocket event stream for one debug session."""

from __future__ import annotations

import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.logging import get_logger
from app.sessions.manager import session_manager

router = APIRouter(tags=["sessions"])
logger = get_logger("pwnviz.ws")


@router.websocket("/sessions/{session_id}/stream")
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    settings = get_settings()
    session = session_manager.get(session_id)
    if session is None:
        await websocket.accept()
        await websocket.close(code=4404, reason="session not found")
        return

    origin = websocket.headers.get("origin")
    if origin and origin not in settings.allowed_origins:
        await websocket.accept()
        await websocket.close(code=4403, reason="origin not allowed")
        return

    await websocket.accept()
    queue = session.subscribe()
    try:
        for event in session.initial_events():
            await websocket.send_json(event)

        while True:
            event = await queue.get()
            await websocket.send_json(event)
            if event.get("type") == "session.terminated":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("websocket stream ended unexpectedly", exc_info=True)
    finally:
        session.unsubscribe(queue)
        with contextlib.suppress(Exception):
            await websocket.close()
