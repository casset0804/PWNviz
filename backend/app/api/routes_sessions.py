"""Debug session REST endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.errors import SessionNotFoundError
from app.schemas.session import (
    ActionRequest,
    ActionResponse,
    CreateSessionRequest,
    SessionInfo,
    SnapshotsResponse,
)
from app.sessions.manager import session_manager

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionInfo, status_code=status.HTTP_201_CREATED)
async def create_session(payload: CreateSessionRequest) -> SessionInfo:
    session = await session_manager.create(payload)
    return session.info()


@router.get("/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str) -> SessionInfo:
    return session_manager.require(session_id).info()


@router.post("/{session_id}/launch", response_model=ActionResponse)
async def launch_session(session_id: str) -> ActionResponse:
    session = session_manager.require(session_id)
    snapshot = await session.launch()
    return ActionResponse(
        session_id=session.session_id,
        state=session.state.value,
        snapshot=snapshot,
    )


@router.post("/{session_id}/actions", response_model=ActionResponse)
async def run_action(session_id: str, payload: ActionRequest) -> ActionResponse:
    session = session_manager.require(session_id)
    state, snapshot = await session.action(payload.action)
    return ActionResponse(
        session_id=session.session_id,
        state=state.value,
        snapshot=snapshot,
    )


@router.get("/{session_id}/snapshots", response_model=SnapshotsResponse)
async def list_snapshots(session_id: str) -> SnapshotsResponse:
    session = session_manager.require(session_id)
    snapshots = session.list_snapshots()
    return SnapshotsResponse(
        session_id=session.session_id,
        count=len(snapshots),
        snapshots=snapshots,
    )


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def terminate_session(session_id: str) -> Response:
    if not await session_manager.terminate(session_id):
        raise SessionNotFoundError(f"Unknown session {session_id!r}.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
