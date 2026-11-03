"""Unit test: a fatal MI/event failure marks ERROR and releases the controller."""

from __future__ import annotations

from app.core.config import get_settings
from app.samples.registry import get_sample
from app.sessions.session import DebugSession
from app.sessions.state import SessionState


class FakeController:
    def __init__(self) -> None:
        self.closed = False
        self.inferior_pid = None
        self.pid = None

    async def close(self) -> None:
        self.closed = True


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
