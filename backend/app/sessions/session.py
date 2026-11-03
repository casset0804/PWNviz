"""One real GDB instance, its state machine, snapshots, and subscribers."""

from __future__ import annotations

import asyncio
import contextlib
import re
import secrets
from collections import deque
from pathlib import Path

from app.collector.snapshot import SnapshotCollector
from app.core.config import Settings
from app.core.errors import (
    DebuggerError,
    DebuggerTimeoutError,
    SessionClosedError,
    SessionStateError,
)
from app.core.logging import get_logger
from app.debugger.mi_controller import (
    MIController,
    MIError,
    MIClosed,
    TargetExited,
)
from app.debugger.pwndbg_loader import load_pwndbg
from app.samples.registry import SampleRecord
from app.schemas.common import utc_now_iso
from app.schemas.session import SessionInfo
from app.schemas.snapshot import Snapshot
from app.sessions.state import SessionState

logger = get_logger("pwnviz.session")

STOP_SYMBOL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]{0,127}$")

EXEC_COMMANDS = {
    "step_instruction": "-exec-step-instruction",
    "next_instruction": "-exec-next-instruction",
    "step": "-exec-step",
    "next": "-exec-next",
    "finish": "-exec-finish",
}


def quote_mi_path(path: Path) -> str:
    text = str(path).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


class DebugSession:
    """A single-user debug session with serialized GDB commands."""

    def __init__(
        self,
        *,
        session_id: str,
        settings: Settings,
        sample: SampleRecord,
        stop_at: str,
        load_pwndbg_enabled: bool,
    ) -> None:
        self.session_id = session_id
        self.settings = settings
        self.sample = sample
        self.stop_at = stop_at
        self.load_pwndbg_enabled = load_pwndbg_enabled
        self.state = SessionState.CREATED
        self.created_at = utc_now_iso()
        self.updated_at = self.created_at
        self.last_error: str | None = None
        self.stop_reason: str | None = None

        self.controller: MIController | None = None
        self.collector: SnapshotCollector | None = None
        self.snapshots: deque[Snapshot] = deque(
            maxlen=max(1, settings.session_max_snapshots)
        )
        self._last_snapshot: Snapshot | None = None
        self._snapshot_seq = 0
        self._next_snapshot_id = 1

        self._lock = asyncio.Lock()
        self._snapshot_condition = asyncio.Condition()
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._pump_task: asyncio.Task[None] | None = None
        self._closed = False
        self._session_warnings: list[str] = []

    @staticmethod
    def new_id() -> str:
        return "sess_" + secrets.token_urlsafe(18)

    # ------------------------------------------------------------------ metadata
    def info(self) -> SessionInfo:
        return SessionInfo(
            session_id=self.session_id,
            sample_id=self.sample.id,
            state=self.state.value,
            created_at=self.created_at,
            updated_at=self.updated_at,
            snapshot_count=len(self.snapshots),
            gdb_pid=self.controller.pid if self.controller else None,
            inferior_pid=self.controller.inferior_pid if self.controller else None,
            last_error=self.last_error,
            stop_reason=self.stop_reason,
        )

    @property
    def latest_snapshot(self) -> Snapshot | None:
        return self._last_snapshot

    def list_snapshots(self) -> list[Snapshot]:
        return list(self.snapshots)

    # ------------------------------------------------------------------ pub/sub
    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self._subscribers.discard(queue)

    def initial_events(self) -> list[dict]:
        events = [self._state_event()]
        if self._last_snapshot is not None:
            events.append(self._snapshot_event(self._last_snapshot))
        if self.state is SessionState.TERMINATED:
            events.append(
                {
                    "type": "session.terminated",
                    "session_id": self.session_id,
                    "payload": {"state": SessionState.TERMINATED.value},
                }
            )
        return events

    def _state_event(self) -> dict:
        return {
            "type": "session.state",
            "session_id": self.session_id,
            "payload": {
                "state": self.state.value,
                "stop_reason": self.stop_reason,
                "last_error": self.last_error,
                "updated_at": self.updated_at,
            },
        }

    def _snapshot_event(self, snapshot: Snapshot) -> dict:
        return {
            "type": "snapshot",
            "session_id": self.session_id,
            "payload": snapshot.model_dump(mode="json"),
        }

    def _broadcast(self, event: dict) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except Exception:  # pragma: no cover - subscriber teardown race
                self._subscribers.discard(queue)

    async def _set_state(self, state: SessionState) -> None:
        self.state = state
        self.updated_at = utc_now_iso()
        self._broadcast(self._state_event())
        async with self._snapshot_condition:
            self._snapshot_condition.notify_all()

    async def _notify_snapshot(self) -> None:
        async with self._snapshot_condition:
            self._snapshot_condition.notify_all()

    # ------------------------------------------------------------------ lifecycle
    async def launch(self) -> Snapshot | None:
        async with self._lock:
            if self.state is not SessionState.CREATED:
                raise SessionStateError(
                    f"Session is {self.state.value}; launch requires CREATED."
                )
            await self._set_state(SessionState.INITIALIZING)
            controller = MIController(self.settings)
            try:
                await controller.start()
                self.controller = controller
                self.collector = SnapshotCollector(self.settings)
                self._session_warnings.extend(controller.warnings)
                self._session_warnings.extend(
                    await load_pwndbg(
                        controller,
                        self.settings,
                        enabled=self.load_pwndbg_enabled,
                    )
                )
                await controller.execute(
                    f"-file-exec-and-symbols {quote_mi_path(self.sample.binary_file)}",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
                if not STOP_SYMBOL_RE.match(self.stop_at):
                    raise DebuggerError("Invalid breakpoint symbol.")
                await controller.execute(
                    f"-break-insert {self.stop_at}",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
                await self._set_state(SessionState.READY)
                self._pump_task = asyncio.create_task(
                    self._event_loop(), name=f"pwnviz-session-{self.session_id}"
                )
                epochs = controller.epochs()
                seq_before = self._snapshot_seq
                await controller.execute(
                    "-exec-run", timeout=self.settings.gdb_command_timeout_seconds
                )
                await self._set_state(SessionState.RUNNING)
            except Exception as exc:
                await self._abort_launch(controller, exc)
                if isinstance(exc, (DebuggerError, SessionStateError)):
                    raise
                raise DebuggerError(
                    f"Could not launch GDB session: {type(exc).__name__}: {exc}"
                ) from exc

        try:
            await controller.wait_for_stop(
                epochs, timeout=self.settings.gdb_stop_timeout_seconds
            )
        except TargetExited:
            await self._wait_until_terminal(3.0)
            return None
        except MIError as exc:
            await self._fail_session(f"Waiting for initial stop failed: {exc}")
            raise DebuggerTimeoutError(
                f"GDB did not stop at {self.stop_at!r}: {exc}"
            ) from exc

        return await self._wait_for_snapshot(
            seq_before, self.settings.gdb_stop_timeout_seconds
        )

    async def _abort_launch(self, controller: MIController, exc: Exception) -> None:
        if self.state is SessionState.TERMINATED:
            return
        self.last_error = f"{type(exc).__name__}: {exc}"
        self._closed = True
        if self._pump_task is not None:
            self._pump_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._pump_task
            self._pump_task = None
        if controller is not None:
            with contextlib.suppress(Exception):
                await controller.close()
        self.controller = None
        self.collector = None
        await self._set_state(SessionState.ERROR)
        self._broadcast(
            {
                "type": "debugger.error",
                "session_id": self.session_id,
                "payload": {"message": self.last_error},
            }
        )

    async def _fail_session(self, message: str) -> None:
        if self.state is SessionState.TERMINATED:
            return
        self.last_error = message
        self._closed = True
        if self._pump_task is not None:
            self._pump_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._pump_task
            self._pump_task = None
        if self.controller is not None:
            with contextlib.suppress(Exception):
                await self.controller.close()
        await self._set_state(SessionState.ERROR)
        self._broadcast(
            {
                "type": "debugger.error",
                "session_id": self.session_id,
                "payload": {"message": message},
            }
        )

    # ------------------------------------------------------------------ actions
    async def launch_or_run(self) -> Snapshot | None:
        return await self.launch()

    async def _step(self, command: str) -> tuple[SessionState, Snapshot | None]:
        async with self._lock:
            self._require_stopped()
            controller = self._controller()
            epochs = controller.epochs()
            seq_before = self._snapshot_seq
            await self._set_state(SessionState.RUNNING)
            try:
                await controller.execute(
                    command, timeout=self.settings.gdb_command_timeout_seconds
                )
            except MIError as exc:
                self.last_error = str(exc)
                if controller.state == "stopped" and not self._closed:
                    await self._set_state(SessionState.STOPPED)
                else:
                    await self._fail_session(
                        f"GDB could not execute {command}: {exc}"
                    )
                raise DebuggerError(
                    f"GDB could not execute {command}: {exc}"
                ) from exc

        try:
            await controller.wait_for_stop(
                epochs, timeout=self.settings.gdb_stop_timeout_seconds
            )
        except TargetExited:
            await self._wait_until_terminal(3.0)
            return self.state, None
        except MIClosed as exc:
            raise SessionClosedError(str(exc)) from exc
        except MIError as exc:
            await self._fail_session(f"No stop after {command}: {exc}")
            raise DebuggerTimeoutError(
                f"No stop event after {command}: {exc}"
            ) from exc

        snapshot = await self._wait_for_snapshot(
            seq_before, self.settings.gdb_stop_timeout_seconds
        )
        if snapshot is None:
            if self.state in {
                SessionState.EXITED,
                SessionState.ERROR,
                SessionState.TERMINATED,
            }:
                return self.state, None
            raise DebuggerTimeoutError(
                f"Stop arrived but the snapshot was not ready in time ({command})."
            )
        return self.state, snapshot

    async def continue_execution(self) -> tuple[SessionState, Snapshot | None]:
        async with self._lock:
            self._require_stopped()
            controller = self._controller()
            seq_before = self._snapshot_seq
            await self._set_state(SessionState.RUNNING)
            try:
                await controller.execute(
                    "-exec-continue",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
            except MIError as exc:
                self.last_error = str(exc)
                if controller.state == "stopped" and not self._closed:
                    await self._set_state(SessionState.STOPPED)
                else:
                    await self._fail_session(f"Continue failed: {exc}")
                raise DebuggerError(f"Continue failed: {exc}") from exc
            snapshot = (
                self._last_snapshot
                if self._snapshot_seq > seq_before
                else None
            )
            return self.state, snapshot

    async def interrupt(self) -> tuple[SessionState, Snapshot | None]:
        async with self._lock:
            if self.state is not SessionState.RUNNING:
                raise SessionStateError(
                    f"Session is {self.state.value}; interrupt requires RUNNING."
                )
            controller = self._controller()
            try:
                await controller.execute(
                    "-exec-interrupt",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
            except MIError as exc:
                await self._fail_session(f"Interrupt failed: {exc}")
                raise DebuggerError(f"Interrupt failed: {exc}") from exc
            return self.state, None

    async def action(
        self, action: str
    ) -> tuple[SessionState, Snapshot | None]:
        if action in {"launch", "run"}:
            snapshot = await self.launch()
            return self.state, snapshot
        if action == "continue":
            return await self.continue_execution()
        if action == "interrupt":
            return await self.interrupt()
        command = EXEC_COMMANDS.get(action)
        if command is None:
            raise SessionStateError(f"Unsupported action {action!r}.")
        return await self._step(command)

    # ------------------------------------------------------------------ events
    async def _event_loop(self) -> None:
        controller = self.controller
        if controller is None:
            return
        try:
            while not self._closed:
                event = await controller.next_event()
                event_type = event.get("type")
                if event_type == "stopped":
                    await self._handle_stop(event["event"])
                elif event_type == "exited":
                    await self._handle_exit(event)
                elif event_type == "closed":
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("session event loop failed")
            async with self._lock:
                if not self._closed:
                    self.last_error = f"Event loop failed: {type(exc).__name__}: {exc}"
                    await self._set_state(SessionState.ERROR)
                    await self._notify_snapshot()

    async def _handle_stop(self, stop_event) -> None:
        async with self._lock:
            if self.state in {
                SessionState.TERMINATED,
                SessionState.ERROR,
                SessionState.EXITED,
            }:
                return
            reason = stop_event.reason or ""
            self.stop_reason = reason or None
            if reason.startswith("exited"):
                # There is no register/memory state worth collecting after exit.
                await self._set_state(SessionState.EXITED)
                await self._notify_snapshot()
                return
            await self._set_state(SessionState.STOPPED)
            if self.controller is None or self.collector is None:
                return
            previous = self.snapshots[-1] if self.snapshots else None
            snapshot_id = self._next_snapshot_id
            try:
                snapshot = await self.collector.collect(
                    self.controller,
                    session_id=self.session_id,
                    snapshot_id=snapshot_id,
                    stop_reason=stop_event.reason,
                    previous=previous,
                )
                if self._session_warnings:
                    snapshot.warnings = list(self._session_warnings) + snapshot.warnings
                self.snapshots.append(snapshot)
                self._last_snapshot = snapshot
                self._next_snapshot_id += 1
                self._snapshot_seq += 1
                self._broadcast(self._snapshot_event(snapshot))
            except Exception as exc:
                self.last_error = (
                    f"Snapshot collection failed: {type(exc).__name__}: {exc}"
                )
                logger.exception("snapshot collection failed")
                self._broadcast(
                    {
                        "type": "debugger.error",
                        "session_id": self.session_id,
                        "payload": {"message": self.last_error},
                    }
                )
            finally:
                await self._notify_snapshot()

    async def _handle_exit(self, event: dict) -> None:
        async with self._lock:
            if self.state in {
                SessionState.TERMINATED,
                SessionState.ERROR,
                SessionState.EXITED,
            }:
                return
            self.stop_reason = str(event.get("reason") or "exited")
            self.last_error = None
            await self._set_state(SessionState.EXITED)
            await self._notify_snapshot()

    async def _wait_for_snapshot(
        self, seq_before: int, timeout: float
    ) -> Snapshot | None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        async with self._snapshot_condition:
            while self._snapshot_seq <= seq_before:
                if self.state in {
                    SessionState.EXITED,
                    SessionState.ERROR,
                    SessionState.TERMINATED,
                }:
                    return None
                remaining = deadline - loop.time()
                if remaining <= 0:
                    return None
                try:
                    await asyncio.wait_for(
                        self._snapshot_condition.wait(), timeout=remaining
                    )
                except asyncio.TimeoutError:
                    return None
            return self._last_snapshot

    async def _wait_until_terminal(self, timeout: float) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        async with self._snapshot_condition:
            while self.state not in {
                SessionState.EXITED,
                SessionState.ERROR,
                SessionState.TERMINATED,
            }:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    return
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(
                        self._snapshot_condition.wait(), timeout=remaining
                    )

    def _require_stopped(self) -> None:
        if self.state is not SessionState.STOPPED:
            raise SessionStateError(
                f"Session is {self.state.value}; this action requires STOPPED."
            )
        if self.controller is None or not self.controller.pid:
            raise SessionClosedError("GDB process is not available.")

    def _controller(self) -> MIController:
        if self.controller is None:
            raise SessionClosedError("Session has no GDB controller.")
        return self.controller

    async def terminate(self) -> None:
        async with self._lock:
            if self.state is SessionState.TERMINATED:
                return
            self._closed = True
            await self._set_state(SessionState.TERMINATED)
            if self._pump_task is not None:
                self._pump_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._pump_task
                self._pump_task = None
            controller = self.controller
            self.controller = None
            if controller is not None:
                with contextlib.suppress(Exception):
                    await controller.close()
            self._broadcast(
                {
                    "type": "session.terminated",
                    "session_id": self.session_id,
                    "payload": {"state": SessionState.TERMINATED.value},
                }
            )
            await self._notify_snapshot()
