"""Unit tests: fatal failures release controllers, launch cancellation cleans up."""

from __future__ import annotations

import asyncio

import pytest

from app.core.config import get_settings
from app.samples.registry import get_sample
from app.sessions import session as session_module
from app.sessions.session import DebugSession
from app.sessions.state import SessionState


class FakeController:
    def __init__(self) -> None:
        self.closed = False
        self.inferior_pid = None
        self.pid = None

    async def close(self) -> None:
        self.closed = True


class BlockingLaunchController(FakeController):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.warnings: list[str] = []

    async def start(self) -> None:
        self.started.set()
        await self.release.wait()

    async def close(self) -> None:
        await super().close()
        self.release.set()


async def test_fatal_error_releases_controller(make_settings) -> None:
    settings = make_settings(
        samples_dir=get_settings().repo_root / "samples",
        allowed_sample_dir=get_settings().repo_root / "samples",
    )
    sample = get_sample(settings.samples_dir, "stack-basic")
    assert sample is not None
    session = DebugSession(
        session_id="sess_test",
        settings=settings,
        sample=sample,
        stop_at="main",
        load_pwndbg_enabled=False,
    )
    fake = FakeController()
    session.controller = fake  # type: ignore[assignment]

    await session._handle_fatal_error("simulated MI reader failure")

    assert session.state is SessionState.ERROR
    assert session.last_error == "simulated MI reader failure"
    assert session.controller is None
    assert fake.closed is True


async def test_cancelled_launch_closes_spawned_controller(
    make_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = make_settings(
        samples_dir=get_settings().repo_root / "samples",
        allowed_sample_dir=get_settings().repo_root / "samples",
    )
    sample = get_sample(settings.samples_dir, "stack-basic")
    assert sample is not None
    session = DebugSession(
        session_id="sess_cancel",
        settings=settings,
        sample=sample,
        stop_at="main",
        load_pwndbg_enabled=False,
    )
    fake = BlockingLaunchController()
    monkeypatch.setattr(
        session_module, "MIController", lambda _settings: fake
    )

    task = asyncio.create_task(session.launch())
    await asyncio.wait_for(fake.started.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert fake.closed is True
    assert session.state is SessionState.ERROR
    assert session.controller is None
