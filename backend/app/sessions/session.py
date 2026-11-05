"""One real GDB instance, its state machine, snapshots, and subscribers."""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import secrets
import time
from collections import deque
from pathlib import Path

from app.analysis.perf import monotonic_ms, summarise_durations
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
from app.schemas.snapshot import Snapshot, SnapshotPerf
from app.sessions.state import SessionState

logger = get_logger("pwnviz.session")

STOP_SYMBOL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]{0,127}$")
SUBSCRIBER_QUEUE_MAX = 256


def _parse_breakpoints(payload: dict) -> list[dict]:
    """Normalize the small ``bkpt`` object from -break-insert for the UI."""
    raw = payload.get("bkpt")
    candidates = raw if isinstance(raw, list) else [raw]
    result: list[dict] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        number = item.get("number")
        address = item.get("addr")
        line = item.get("line")
        try:
            parsed_line = int(str(line)) if line is not None else None
        except (TypeError, ValueError):
            parsed_line = None
        result.append(
            {
                "number": str(number) if number is not None else None,
                "address": str(address) if address else None,
                "function": item.get("func") or None,
                "file": item.get("fullname") or item.get("file") or None,
                "line": parsed_line,
                "enabled": str(item.get("enabled", "y")).lower() == "y",
            }
        )
    return result

EXEC_COMMANDS = {
    "step_instruction": "-exec-step-instruction",
    "next_instruction": "-exec-next-instruction",
    "step": "-exec-step",
    "next": "-exec-next",
    "finish": "-exec-finish",
}


def quote_mi_path(path: Path) -> str:
    text = str(path)
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in text):
        raise DebuggerError("Sample path contains control characters.")
    text = text.replace("\\", "\\\\").replace('"', '\\"')
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
        self._breakpoints: list[dict] = []
        self._output_seq = 0
        self._last_activity = time.monotonic()

        # V1.1 snapshot modes and measured performance.
        self.snapshot_mode_default = (
            settings.snapshot_mode_default
            if settings.snapshot_mode_default in {"fast", "full"}
            else "fast"
        )
        self._pending_mode: str = "full"
        self._pending_action: str | None = None
        self.last_perf: SnapshotPerf | None = None
        self.perf_history: deque[SnapshotPerf] = deque(
            maxlen=max(8, min(settings.perf_history_size, 2000))
        )
        self.last_ws_send_ms: float | None = None

    @staticmethod
    def new_id() -> str:
        return "sess_" + secrets.token_urlsafe(18)

    def touch(self) -> None:
        """Record user-visible activity for the idle-session reaper."""
        self._last_activity = time.monotonic()

    def idle_seconds(self, now: float | None = None) -> float:
        return max(0.0, (time.monotonic() if now is None else now) - self._last_activity)

    @property
    def has_subscribers(self) -> bool:
        return bool(self._subscribers)

    # ------------------------------------------------------------------ metadata
    def info(self) -> SessionInfo:
        self.touch()
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
        self.touch()
        return list(self.snapshots)

    # ------------------------------------------------------------------ pub/sub
    def subscribe(self) -> asyncio.Queue[dict]:
        # A slow/dead WebSocket subscriber must not grow an unbounded queue for
        # every snapshot. Keep the newest events instead; the client can always
        # recover the latest state from its initial REST/WS snapshot.
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_MAX)
        self._subscribers.add(queue)
        self.touch()
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self._subscribers.discard(queue)
        self.touch()

    def initial_events(self) -> list[dict]:
        events = [self._state_event()]
        if self._last_snapshot is not None:
            events.append(self._snapshot_event(self._last_snapshot))
        if self._breakpoints:
            events.append(self._breakpoints_event())
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

    def _snapshot_event(self, snapshot: Snapshot, payload: dict | None = None) -> dict:
        return {
            "type": "snapshot",
            "session_id": self.session_id,
            "payload": payload
            if payload is not None
            else snapshot.model_dump(mode="json"),
        }

    def _breakpoints_event(self) -> dict:
        return {
            "type": "breakpoints.updated",
            "session_id": self.session_id,
            "payload": {"breakpoints": list(self._breakpoints)},
        }

    def _broadcast(self, event: dict) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop the oldest queued event and retain the newest state.
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
            except Exception:  # pragma: no cover - subscriber teardown race
                self._subscribers.discard(queue)

    async def _publish_snapshot(self, snapshot: Snapshot) -> None:
        """Serialize once, measure it, then queue the event for subscribers.

        ``serialize_ms`` covers the pydantic model dump plus the exact JSON byte
        count; ``payload_bytes`` is the number of bytes the WebSocket layer will
        send. Both are measured before broadcasting so they can travel with the
        payload itself. The actual socket send time is recorded separately by the
        WebSocket endpoint (``record_ws_send``) because it happens later.
        """
        perf = snapshot.perf
        payload: dict = {}
        if perf is not None:
            started = monotonic_ms()
            payload = snapshot.model_dump(mode="json")
            encode_ms = monotonic_ms() - started
            size_started = monotonic_ms()
            payload_bytes = len(json.dumps(payload, separators=(",", ":")))
            size_ms = monotonic_ms() - size_started
            perf.serialize_ms = round(encode_ms + size_ms, 3)
            perf.payload_bytes = payload_bytes
            payload["perf"] = perf.model_dump(mode="json")
        else:  # pragma: no cover - every snapshot is collected with a recorder
            payload = snapshot.model_dump(mode="json")

        broadcast_started = monotonic_ms()
        self._broadcast(self._snapshot_event(snapshot, payload))
        if perf is not None:
            perf.broadcast_ms = round(monotonic_ms() - broadcast_started, 3)
            self.last_perf = perf
            self.perf_history.append(perf.model_copy(deep=True))

    async def _set_state(self, state: SessionState) -> None:
        self.state = state
        self.updated_at = utc_now_iso()
        self._broadcast(self._state_event())
        async with self._snapshot_condition:
            self._snapshot_condition.notify_all()

    async def _notify_snapshot(self) -> None:
        async with self._snapshot_condition:
            self._snapshot_condition.notify_all()

    async def _release_collector(self) -> None:
        """Delete cached GDB variable objects before the controller goes away."""
        collector = self.collector
        controller = self.controller
        self.collector = None
        if collector is None or controller is None:
            return
        try:
            await collector.close(controller)
        except Exception:
            logger.warning(
                "failed to release cached variable objects for %s",
                self.session_id,
                exc_info=True,
            )

    async def _close_controller(self) -> None:
        controller = self.controller
        self.controller = None
        if controller is not None:
            try:
                await controller.close()
            except Exception:
                logger.warning(
                    "failed to close GDB controller for %s",
                    self.session_id,
                    exc_info=True,
                )

    # ------------------------------------------------------------------ lifecycle
    async def launch(self) -> Snapshot | None:
        self.touch()
        async with self._lock:
            if self.state is not SessionState.CREATED:
                raise SessionStateError(
                    f"Session is {self.state.value}; launch requires CREATED.",
                    params={
                        "state": self.state.value,
                        "required": "CREATED",
                        "action": "launch",
                    },
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
                # GDB stops unwinding at `main` by default when no user init has
                # changed `backtrace past-main` (the backend deliberately runs
                # with --nx and may skip pwndbg). The graphical stack map needs
                # the real caller frames above main to cross-check frame
                # boundaries, so enable it explicitly *after* any pwndbg init so
                # that init cannot overwrite it. This changes only how far GDB
                # unwinds; no frame is fabricated.
                try:
                    await controller.execute(
                        '-interpreter-exec console "set backtrace past-main on"',
                        timeout=self.settings.gdb_command_timeout_seconds,
                    )
                except MIError as exc:
                    self._session_warnings.append(
                        "Could not enable `backtrace past-main`; caller frames "
                        f"above main may be missing: {exc}"
                    )
                await controller.execute(
                    f"-file-exec-and-symbols {quote_mi_path(self.sample.binary_file)}",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
                if not STOP_SYMBOL_RE.match(self.stop_at):
                    raise DebuggerError("Invalid breakpoint symbol.")
                breakpoint_record = await controller.execute(
                    f"-break-insert {self.stop_at}",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
                self._breakpoints = _parse_breakpoints(
                    breakpoint_record.get("payload") or {}
                )
                self._broadcast(self._breakpoints_event())
                await self._set_state(SessionState.READY)
                self._pump_task = asyncio.create_task(
                    self._event_loop(), name=f"pwnviz-session-{self.session_id}"
                )
                epochs = controller.epochs()
                seq_before = self._snapshot_seq
                # The initial stop is a new frame and an unknown call stack:
                # collect it fully. Every later step defaults to fast mode.
                self._pending_mode = "full"
                self._pending_action = "launch"
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
            except asyncio.CancelledError:
                # Client disconnect / shutdown during startup must still release
                # a GDB process that was already spawned.
                await self._abort_launch(
                    controller, RuntimeError("launch cancelled")
                )
                raise

        try:
            await controller.wait_for_stop(
                epochs, timeout=self.settings.gdb_stop_timeout_seconds
            )
        except asyncio.CancelledError:
            await self._fail_session("Launch cancelled while waiting for initial stop")
            raise
        except TargetExited:
            await self._wait_until_terminal(3.0)
            return None
        except MIError as exc:
            await self._fail_session(f"Waiting for initial stop failed: {exc}")
            raise DebuggerTimeoutError(
                f"GDB did not stop at {self.stop_at!r}: {exc}"
            ) from exc

        try:
            snapshot = await self._wait_for_snapshot(
                seq_before, self.settings.gdb_stop_timeout_seconds
            )
        except asyncio.CancelledError:
            await self._fail_session(
                "Launch cancelled while collecting the initial snapshot"
            )
            raise
        if snapshot is None:
            if self.state in {
                SessionState.EXITED,
                SessionState.ERROR,
                SessionState.TERMINATED,
            }:
                return None
            message = "Initial stop arrived but the snapshot was not ready in time."
            await self._fail_session(message)
            raise DebuggerTimeoutError(message)
        return snapshot

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
            try:
                await controller.close()
            except Exception:
                logger.warning(
                    "failed to close GDB controller during launch abort for %s",
                    self.session_id,
                    exc_info=True,
                )
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
        if self.state in {SessionState.TERMINATED, SessionState.EXITED}:
            return
        self.last_error = message
        self._closed = True
        if self._pump_task is not None:
            self._pump_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._pump_task
            self._pump_task = None
        await self._close_controller()
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

    async def _step(
        self, command: str, *, mode: str | None = None
    ) -> tuple[SessionState, Snapshot | None]:
        self.touch()
        async with self._lock:
            self._require_stopped()
            controller = self._controller()
            epochs = controller.epochs()
            seq_before = self._snapshot_seq
            self._pending_mode = self._resolve_mode(mode)
            self._pending_action = command.removeprefix("-exec-").replace("-", "_")
            await self._set_state(SessionState.RUNNING)
            try:
                await controller.execute(
                    command, timeout=self.settings.gdb_command_timeout_seconds
                )
            except asyncio.CancelledError:
                await self._fail_session(f"{command} cancelled while sending")
                raise
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
        except asyncio.CancelledError:
            await self._fail_session(f"{command} cancelled while waiting for stop")
            raise
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

        try:
            snapshot = await self._wait_for_snapshot(
                seq_before, self.settings.gdb_stop_timeout_seconds
            )
        except asyncio.CancelledError:
            await self._fail_session(f"{command} cancelled while collecting snapshot")
            raise
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

    async def continue_execution(
        self, *, mode: str | None = None
    ) -> tuple[SessionState, Snapshot | None]:
        self.touch()
        async with self._lock:
            self._require_stopped()
            controller = self._controller()
            seq_before = self._snapshot_seq
            self._pending_mode = self._resolve_mode(mode)
            self._pending_action = "continue"
            await self._set_state(SessionState.RUNNING)
            try:
                await controller.execute(
                    "-exec-continue",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
            except asyncio.CancelledError:
                await self._fail_session("Continue cancelled while sending")
                raise
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
        self.touch()
        async with self._lock:
            if self.state is not SessionState.RUNNING:
                raise SessionStateError(
                    f"Session is {self.state.value}; interrupt requires RUNNING.",
                    params={
                        "state": self.state.value,
                        "required": "RUNNING",
                        "action": "interrupt",
                    },
                )
            controller = self._controller()
            try:
                await controller.execute(
                    "-exec-interrupt",
                    timeout=self.settings.gdb_command_timeout_seconds,
                )
            except asyncio.CancelledError:
                await self._fail_session("Interrupt cancelled while sending")
                raise
            except MIError as exc:
                await self._fail_session(f"Interrupt failed: {exc}")
                raise DebuggerError(f"Interrupt failed: {exc}") from exc
            return self.state, None

    async def action(
        self, action: str, *, mode: str | None = None
    ) -> tuple[SessionState, Snapshot | None]:
        if action in {"launch", "run"}:
            snapshot = await self.launch()
            return self.state, snapshot
        if action == "continue":
            return await self.continue_execution(mode=mode)
        if action == "interrupt":
            return await self.interrupt()
        command = EXEC_COMMANDS.get(action)
        if command is None:
            raise SessionStateError(
                f"Unsupported action {action!r}.",
                params={"action": action},
            )
        return await self._step(command, mode=mode)

    def _resolve_mode(self, mode: str | None) -> str:
        if mode in {"fast", "full"}:
            return mode  # type: ignore[return-value]
        return self.snapshot_mode_default

    async def refresh(self, *, mode: str = "full") -> Snapshot:
        """Re-collect the current stop, refreshing frames, disassembly, variables.

        This is the user-triggered "refresh variables" path: it never executes
        the inferior and never fabricates data: it just asks GDB to re-measure
        the same stop with the full collector.
        """
        self.touch()
        async with self._lock:
            self._require_stopped()
            controller = self._controller()
            collector = self.collector
            if collector is None:
                raise SessionClosedError(
                    "Session has no snapshot collector.",
                    params={"reason": "no_collector"},
                )
            previous = self.snapshots[-1] if self.snapshots else None
            snapshot_id = self._next_snapshot_id
            snapshot = await collector.collect(
                controller,
                session_id=self.session_id,
                snapshot_id=snapshot_id,
                stop_reason=self.stop_reason,
                previous=previous,
                mode="full" if mode == "full" else "fast",
                action="refresh",
                force_variables=True,
            )
            if self._session_warnings:
                snapshot.warnings = list(self._session_warnings) + snapshot.warnings
            self.snapshots.append(snapshot)
            self._last_snapshot = snapshot
            self._next_snapshot_id += 1
            self._snapshot_seq += 1
            await self._publish_snapshot(snapshot)
            await self._notify_snapshot()
            return snapshot

    def record_ws_send(self, duration_ms: float, payload_bytes: int | None = None) -> None:
        """Called by the WebSocket endpoint after ``send_json`` returns."""
        self.last_ws_send_ms = duration_ms
        perf = self.last_perf
        if perf is not None:
            perf.ws_send_ms = round(duration_ms, 3)
            if payload_bytes is not None:
                perf.payload_bytes = payload_bytes

    def perf_report(self) -> dict:
        """Latest + aggregate performance facts for the debugger UI."""
        history = list(self.perf_history)
        totals = [perf.total_ms for perf in history]
        commands = [float(perf.mi_command_count) for perf in history]
        serialize = [
            perf.serialize_ms for perf in history if perf.serialize_ms is not None
        ]
        ws_send = [perf.ws_send_ms for perf in history if perf.ws_send_ms is not None]
        return {
            "session_id": self.session_id,
            "last": self.last_perf.model_dump(mode="json")
            if self.last_perf is not None
            else None,
            "samples": len(history),
            "aggregate": {
                "total_ms": summarise_durations(totals),
                "mi_command_count": summarise_durations(commands),
                "serialize_ms": summarise_durations(serialize),
                "ws_send_ms": summarise_durations(ws_send),
            },
            "recent": [perf.model_dump(mode="json") for perf in history[-20:]],
        }

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
                elif event_type == "output":
                    text = str(event.get("text") or "")[:1000]
                    if text:
                        self._output_seq += 1
                        output_event = {
                            "type": "debugger.output",
                            "session_id": self.session_id,
                            "payload": {
                                "stream": event.get("stream") or "output",
                                "text": text,
                                "seq": self._output_seq,
                            },
                        }
                        self._broadcast(output_event)
                elif event_type == "error":
                    await self._handle_fatal_error(
                        str(event.get("message") or "MI reader failed")
                    )
                    break
                elif event_type == "closed":
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("session event loop failed")
            await self._handle_fatal_error(
                f"Event loop failed: {type(exc).__name__}: {exc}"
            )

    async def _handle_fatal_error(self, message: str) -> None:
        """Reader/event-loop failure: mark ERROR and release the GDB process."""
        async with self._lock:
            if self.state in {
                SessionState.TERMINATED,
                SessionState.ERROR,
                SessionState.EXITED,
            }:
                return
            self.last_error = message
            self._closed = True
            await self._set_state(SessionState.ERROR)
            self._broadcast(
                {
                    "type": "debugger.error",
                    "session_id": self.session_id,
                    "payload": {"message": message},
                }
            )
        await self._close_controller()
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
                # Release GDB immediately so an abandoned session cannot retain
                # a debugger process forever.
                await self._set_state(SessionState.EXITED)
                self._closed = True
                await self._notify_snapshot()
                await self._close_controller()
                return
            await self._set_state(SessionState.STOPPED)
            if self.controller is None or self.collector is None:
                return
            self.touch()
            previous = self.snapshots[-1] if self.snapshots else None
            snapshot_id = self._next_snapshot_id
            mode = self._pending_mode
            action = self._pending_action
            self._pending_mode = self.snapshot_mode_default
            self._pending_action = None
            try:
                snapshot = await self.collector.collect(
                    self.controller,
                    session_id=self.session_id,
                    snapshot_id=snapshot_id,
                    stop_reason=stop_event.reason,
                    previous=previous,
                    mode=mode,
                    action=action,
                )
                if self._session_warnings:
                    snapshot.warnings = list(self._session_warnings) + snapshot.warnings
                self.snapshots.append(snapshot)
                self._last_snapshot = snapshot
                self._next_snapshot_id += 1
                self._snapshot_seq += 1
                await self._publish_snapshot(snapshot)
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
            self._closed = True
            await self._notify_snapshot()
        await self._close_controller()

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
                f"Session is {self.state.value}; this action requires STOPPED.",
                params={"state": self.state.value, "required": "STOPPED"},
            )
        if self.controller is None or not self.controller.pid:
            raise SessionClosedError(
                "GDB process is not available.",
                params={"reason": "gdb_unavailable"},
            )

    def _controller(self) -> MIController:
        if self.controller is None:
            raise SessionClosedError(
                "Session has no GDB controller.",
                params={"reason": "no_controller"},
            )
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
            await self._release_collector()
            await self._close_controller()
            self._broadcast(
                {
                    "type": "session.terminated",
                    "session_id": self.session_id,
                    "payload": {"state": SessionState.TERMINATED.value},
                }
            )
            await self._notify_snapshot()
