"""Idle-session reaper tests (no debugger process required)."""

from __future__ import annotations

import asyncio

from app.core.config import get_settings
from app.samples.registry import get_sample
from app.schemas.session import CreateSessionRequest
from app.sessions.manager import SessionManager
from app.sessions.state import SessionState


async def test_idle_session_is_reaped_and_cleaned(make_settings) -> None:
    settings = make_settings(
        samples_dir=get_settings().repo_root / "samples",
        allowed_sample_dir=get_settings().repo_root / "samples",
        session_idle_timeout_seconds=0.05,
    )
    manager = SessionManager()
    await manager.start(settings)
    try:
        session = await manager.create(
            CreateSessionRequest(sample_id="stack-basic", load_pwndbg=False),
            settings,
        )
        await asyncio.sleep(0.08)
        reaped = await manager.reap_idle()
        assert reaped == [session.session_id]
        assert manager.get(session.session_id) is None
        await asyncio.sleep(0.02)
        assert session.state is SessionState.TERMINATED
    finally:
        await manager.shutdown()


async def test_subscribed_session_is_not_idle(make_settings) -> None:
    settings = make_settings(
        samples_dir=get_settings().repo_root / "samples",
        allowed_sample_dir=get_settings().repo_root / "samples",
        session_idle_timeout_seconds=0.05,
    )
    manager = SessionManager()
    manager._settings = settings
    try:
        session = await manager.create(
            CreateSessionRequest(sample_id="stack-basic", load_pwndbg=False),
            settings,
        )
        queue = session.subscribe()
        await asyncio.sleep(0.08)
        assert await manager.reap_idle() == []
        assert manager.get(session.session_id) is session
        session.unsubscribe(queue)
        await asyncio.sleep(0.08)
        assert await manager.reap_idle() == [session.session_id]
    finally:
        await manager.shutdown()
