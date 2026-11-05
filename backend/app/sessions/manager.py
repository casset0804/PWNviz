"""Session registry and lifecycle ownership."""

from __future__ import annotations

import asyncio
import contextlib
import time

from app.core.config import Settings, get_settings
from app.core.errors import (
    SampleNotFoundError,
    SampleNotBuiltError,
    SessionNotFoundError,
    TooManySessionsError,
)
from app.core.logging import get_logger
from app.samples.registry import discover_samples, get_sample
from app.schemas.session import CreateSessionRequest
from app.sessions.session import DebugSession

logger = get_logger("pwnviz.sessions")


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, DebugSession] = {}
        self._lock = asyncio.Lock()
        self._cleanup_tasks: set[asyncio.Task[None]] = set()
        self._reaper_task: asyncio.Task[None] | None = None
        self._settings: Settings | None = None

    async def start(self, settings: Settings | None = None) -> None:
        """Start the idle-session reaper owned by the application lifespan."""
        self._settings = settings or get_settings()
        if self._reaper_task is None or self._reaper_task.done():
            self._reaper_task = asyncio.create_task(
                self._reap_loop(), name="pwnviz-session-reaper"
            )

    async def _reap_loop(self) -> None:
        settings = self._settings or get_settings()
        timeout = settings.session_idle_timeout_seconds
        interval = max(1.0, min(30.0, settings.session_reaper_interval_seconds))
        try:
            while True:
                await asyncio.sleep(interval)
                if timeout <= 0:
                    continue
                await self.reap_idle(timeout)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("session reaper loop failed")
            raise

    async def reap_idle(self, timeout: float | None = None) -> list[str]:
        """Terminate abandoned sessions; return the IDs actually reaped."""
        settings = self._settings or get_settings()
        budget = timeout if timeout is not None else settings.session_idle_timeout_seconds
        if budget <= 0:
            return []
        now = time.monotonic()
        reaped: list[str] = []
        for session in list(self._sessions.values()):
            if session.has_subscribers:
                continue
            if session.idle_seconds(now) < budget:
                continue
            if self._sessions.pop(session.session_id, None) is None:
                continue
            logger.warning(
                "reaping idle session %s after %.1fs without activity",
                session.session_id,
                session.idle_seconds(now),
            )
            self._spawn_cleanup(session)
            reaped.append(session.session_id)
        return reaped

    def _spawn_cleanup(self, session: DebugSession) -> None:
        cleanup = asyncio.create_task(
            session.terminate(), name=f"pwnviz-terminate-{session.session_id}"
        )
        self._cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(self._cleanup_done)

    def _cleanup_done(self, task: asyncio.Task[None]) -> None:
        self._cleanup_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            logger.error("session cleanup task failed: %s", error)

    async def create(
        self, request: CreateSessionRequest, settings: Settings | None = None
    ) -> DebugSession:
        settings = settings or get_settings()
        sample = get_sample(settings.samples_dir, request.sample_id)
        if sample is None:
            raise SampleNotFoundError(
                f"Unknown sample {request.sample_id!r}.",
                detail={
                    "available": [
                        record.id
                        for record in discover_samples(settings.samples_dir)
                    ]
                },
            )
        if not sample.binary_exists:
            raise SampleNotBuiltError(
                f"Sample {sample.id!r} has no compiled binary.",
                detail={"build_command": sample.build_command()},
            )

        load_pwndbg = (
            settings.load_pwndbg
            if request.load_pwndbg is None
            else request.load_pwndbg
        )
        session = DebugSession(
            session_id=self._new_id(),
            settings=settings,
            sample=sample,
            stop_at=request.stop_at,
            load_pwndbg_enabled=load_pwndbg,
        )
        async with self._lock:
            if len(self._sessions) >= max(1, settings.session_max_active):
                raise TooManySessionsError(
                    "Too many active debug sessions.",
                    detail={"max_active": settings.session_max_active},
                )
            self._sessions[session.session_id] = session
        logger.info(
            "created session %s for %s", session.session_id, sample.id
        )
        return session

    def _new_id(self) -> str:
        while True:
            candidate = DebugSession.new_id()
            if candidate not in self._sessions:
                return candidate

    def get(self, session_id: str) -> DebugSession | None:
        return self._sessions.get(session_id)

    def require(self, session_id: str) -> DebugSession:
        session = self.get(session_id)
        if session is None:
            raise SessionNotFoundError(f"Unknown session {session_id!r}.")
        return session

    def all(self) -> list[DebugSession]:
        return list(self._sessions.values())

    async def terminate(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        # Keep cleanup owned by a task: a cancelled DELETE request must not
        # cancel the only GDB teardown path after the session was removed.
        cleanup = asyncio.create_task(
            session.terminate(), name=f"pwnviz-terminate-{session_id}"
        )
        self._cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(self._cleanup_done)
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            logger.warning(
                "terminate request cancelled; session cleanup continues for %s",
                session_id,
            )
            raise
        logger.info("terminated session %s", session_id)
        return True

    async def shutdown(self) -> None:
        reaper = self._reaper_task
        self._reaper_task = None
        if reaper is not None and not reaper.done():
            reaper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reaper
        sessions = list(self._sessions.values())
        self._sessions.clear()
        for session in sessions:
            try:
                await session.terminate()
            except Exception:
                logger.exception("failed to terminate session %s", session.session_id)
        if self._cleanup_tasks:
            await asyncio.gather(*list(self._cleanup_tasks), return_exceptions=True)


session_manager = SessionManager()


__all__ = ["SessionManager", "session_manager"]
