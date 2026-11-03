"""Bounded subscriber queues prevent slow WebSocket clients from growing memory."""

from __future__ import annotations

from app.core.config import get_settings
from app.samples.registry import get_sample
from app.sessions.session import DebugSession, SUBSCRIBER_QUEUE_MAX


async def test_slow_subscriber_keeps_latest_events() -> None:
    settings = get_settings()
    sample = get_sample(settings.samples_dir, "stack-basic")
    assert sample is not None
    session = DebugSession(
        session_id="sess_backpressure",
        settings=settings,
        sample=sample,
        stop_at="main",
        load_pwndbg_enabled=False,
    )
    queue = session.subscribe()

    for index in range(SUBSCRIBER_QUEUE_MAX + 20):
        session._broadcast({"type": "test", "index": index})

    assert queue.qsize() == SUBSCRIBER_QUEUE_MAX
    drained = []
    while not queue.empty():
        drained.append(queue.get_nowait())
    assert drained[-1]["index"] == SUBSCRIBER_QUEUE_MAX + 19
    assert drained[0]["index"] == 20
