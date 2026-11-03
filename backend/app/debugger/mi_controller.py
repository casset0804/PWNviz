"""GDB/MI3 controller: token correlation, async events, and a resilient reader.

One reader task owns all reads. Commands are written with monotonically increasing
MI tokens; result records resolve that command's future while notify records are
queued for the session state machine. A command timeout never stops the reader, so
later ``*stopped``/exit events are still delivered.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import os
import signal
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.core.logging import get_logger
from app.debugger.gdb_process import GdbProcess, GdbProcessError

logger = get_logger("pwnviz.mi")
MAX_QUEUED_OUTPUT_EVENTS = 512


class MIError(RuntimeError):
    """Base error for MI command/transport failures."""


class MICommandError(MIError):
    def __init__(self, command: str, message: str) -> None:
        super().__init__(f"{command}: {message}")
        self.command = command
        self.message = message


class MICommandTimeout(MIError):
    def __init__(self, command: str, timeout: float) -> None:
        super().__init__(f"GDB did not answer {command!r} within {timeout:g}s")
        self.command = command
        self.timeout = timeout


class MIStopTimeout(MIError):
    def __init__(self, timeout: float) -> None:
        super().__init__(f"GDB did not report a stop event within {timeout:g}s")
        self.timeout = timeout


class TargetExited(MIError):
    def __init__(self, exit_code: str | None = None) -> None:
        super().__init__(f"Inferior exited (code={exit_code})")
        self.exit_code = exit_code


class MIClosed(MIError):
    pass


@dataclass(frozen=True)
class StopEvent:
    epoch: int
    reason: str | None
    payload: dict[str, Any]


@dataclass(frozen=True)
class Epochs:
    stop: int
    exit: int


class MIController:
    """Async facade over one persistent pygdbmi-backed GDB process."""

    def __init__(self, settings: Settings, *, gdb_process: GdbProcess | None = None) -> None:
        self.settings = settings
        self._gdb = gdb_process or GdbProcess(settings)
        self._reader_task: asyncio.Task[None] | None = None
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._tokens = itertools.count(1)
        self._write_lock = asyncio.Lock()
        self._state_condition = asyncio.Condition()
        self._events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._closed = False
        self._fatal_error: str | None = None
        self._state = "unknown"
        self._stop_epoch = 0
        self._exit_epoch = 0
        self._last_stop: StopEvent | None = None
        self._exit_code: str | None = None
        self.inferior_pid: int | None = None
        self._recent_output: deque[str] = deque(maxlen=400)
        self.warnings: list[str] = []
        self.last_command_error: str | None = None
        self._inferior_starttime: str | None = None

    # ------------------------------------------------------------------ lifecycle
    @property
    def pid(self) -> int | None:
        return self._gdb.pid

    @property
    def state(self) -> str:
        return self._state

    @property
    def stop_epoch(self) -> int:
        return self._stop_epoch

    @property
    def exit_epoch(self) -> int:
        return self._exit_epoch

    @property
    def last_stop(self) -> StopEvent | None:
        return self._last_stop

    def epochs(self) -> Epochs:
        return Epochs(stop=self._stop_epoch, exit=self._exit_epoch)

    async def start(self) -> None:
        # Popen + IoManager setup is short and must not run in a worker thread:
        # if the surrounding request is cancelled, the thread could spawn GDB
        # after the session has already been cleaned up.
        self._gdb.start()
        self._reader_task = asyncio.create_task(
            self._read_loop(), name="pwnviz-mi-reader"
        )
        await self._initial_settings()

    async def _initial_settings(self) -> None:
        initial_commands = (
            "-gdb-set confirm off",
            "-gdb-set pagination off",
            "-gdb-set width 0",
            "-gdb-set height 0",
            "-gdb-set mi-async on",
        )
        for command in initial_commands:
            try:
                await self.execute(command, timeout=min(5.0, self._command_timeout()))
            except (MIError, GdbProcessError) as exc:
                # mi-async is important for Pause; record it but keep debugging.
                self.warnings.append(f"GDB init command failed: {exc}")
                logger.warning("GDB init command failed: %s", exc)

    async def close(self) -> None:
        if self._closed:
            return
        # Stop accepting commands immediately. The process cleanup below runs in
        # a synchronous finally block so cancellation of the owning request/task
        # cannot leave GDB or its process group behind.
        self._closed = True
        reader = self._reader_task
        self._reader_task = None
        try:
            # Ask GDB to exit first so it can kill the inferior; the process-group
            # kill below is the safety net if it hangs or was already wedged.
            if self._gdb.alive:
                try:
                    await asyncio.to_thread(self._gdb.write, "-gdb-exit")
                except GdbProcessError:
                    pass
                await asyncio.to_thread(self._gdb.wait_exit, 2.0)
        finally:
            try:
                self._gdb.kill()
            except Exception:
                logger.warning("failed to kill GDB process group", exc_info=True)
            try:
                self._gdb.close()
            except Exception:
                logger.warning("failed to close GDB pipes", exc_info=True)
            if reader is not None:
                reader.cancel()
            self._kill_orphan_inferior()

        if reader is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await reader
        await self._notify_state()
        self._events.put_nowait({"type": "closed"})

    @staticmethod
    def _proc_starttime(pid: int) -> str | None:
        """Read field 22 (starttime) from /proc/<pid>/stat, if available."""
        try:
            raw = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
        except OSError:
            return None
        try:
            fields = raw.rsplit(")", 1)[1].split()
            return fields[19]
        except (IndexError, AttributeError):
            return None

    def _kill_orphan_inferior(self) -> None:
        """Kill an inferior that survived a GDB crash, without PID-reuse risk.

        The inferior PID is only killed when its /proc starttime still matches
        the value observed at thread-group-started.
        """
        pid = self.inferior_pid
        expected = self._inferior_starttime
        if not pid or expected is None:
            return
        current = self._proc_starttime(pid)
        if current is None or current != expected:
            return
        try:
            os.kill(pid, signal.SIGKILL)
            logger.warning("killed orphan inferior pid=%s after GDB exit", pid)
        except (ProcessLookupError, PermissionError):
            pass

    # ------------------------------------------------------------------ commands
    def _command_timeout(self) -> float:
        return self.settings.gdb_command_timeout_seconds

    def _queue_output(self, stream: str, text: str) -> None:
        """Queue diagnostics without letting a chatty inferior grow memory forever."""
        if self._events.qsize() >= MAX_QUEUED_OUTPUT_EVENTS:
            return
        self._events.put_nowait(
            {"type": "output", "stream": stream, "text": text}
        )

    async def execute(
        self,
        command: str,
        *,
        timeout: float | None = None,
        allow_closed: bool = False,
    ) -> dict[str, Any]:
        """Send one MI command and wait for its token-tagged result record."""
        if self._closed and not allow_closed:
            raise MIClosed("GDB controller is closed")
        if self._fatal_error is not None:
            raise MIError(self._fatal_error)
        token = next(self._tokens)
        future: asyncio.Future[dict[str, Any]] = (
            asyncio.get_running_loop().create_future()
        )
        self._pending[token] = future
        try:
            async with self._write_lock:
                await asyncio.to_thread(self._gdb.write, f"{token}{command}")
            record = await asyncio.wait_for(
                future, timeout=timeout or self._command_timeout()
            )
        except asyncio.TimeoutError as exc:
            raise MICommandTimeout(
                command, timeout or self._command_timeout()
            ) from exc
        except GdbProcessError as exc:
            raise MIError(str(exc)) from exc
        finally:
            self._pending.pop(token, None)

        message = record.get("message")
        if message == "error":
            payload = record.get("payload") or {}
            detail = payload.get("msg") or payload.get("message") or "GDB error"
            self.last_command_error = str(detail)
            raise MICommandError(command, str(detail))
        self._queue_output("mi", f"{command} → {message}")
        return record

    async def wait_for_stop(
        self, epochs: Epochs, *, timeout: float | None = None
    ) -> StopEvent:
        """Wait until a stop newer than ``epochs`` arrives or the inferior exits."""
        budget = timeout or self.settings.gdb_stop_timeout_seconds
        deadline = asyncio.get_running_loop().time() + budget
        async with self._state_condition:
            while True:
                if self._last_stop is not None and self._stop_epoch > epochs.stop:
                    return self._last_stop
                if self._exit_epoch > epochs.exit:
                    raise TargetExited(self._exit_code)
                if self._fatal_error is not None:
                    raise MIError(self._fatal_error)
                if self._closed:
                    raise MIClosed("GDB controller closed while waiting for a stop")
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise MIStopTimeout(budget)
                try:
                    await asyncio.wait_for(
                        self._state_condition.wait(), timeout=remaining
                    )
                except asyncio.TimeoutError as exc:
                    raise MIStopTimeout(budget) from exc

    # ------------------------------------------------------------------ reader
    async def _read_loop(self) -> None:
        while not self._closed:
            try:
                records = await asyncio.to_thread(self._gdb.read, 0.2)
            except GdbProcessError as exc:
                if not self._closed:
                    logger.warning("GDB reader stopped: %s", exc)
                    await self._reader_failed(str(exc))
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # closed pipes, parser edge cases
                if not self._closed:
                    logger.warning("GDB reader failed: %s", exc)
                    await self._reader_failed(str(exc))
                return
            for record in records:
                await self._handle_record(record)
            if not self._gdb.alive and not records:
                # Let the session see a terminal state even if GDB died abruptly.
                await self._handle_abnormal_exit()
                return

    async def _reader_failed(self, message: str) -> None:
        """Wake waiters and surface a permanent reader failure to the session."""
        if self._fatal_error is not None:
            return
        self._fatal_error = f"MI reader failed: {message}"
        self._state = "error"
        await self._notify_state()
        self._events.put_nowait(
            {"type": "error", "message": self._fatal_error}
        )

    async def _handle_abnormal_exit(self) -> None:
        if self._state == "exited":
            return
        self._state = "exited"
        self._exit_epoch += 1
        self._exit_code = self._exit_code or "unknown"
        await self._notify_state()
        self._events.put_nowait(
            {"type": "exited", "reason": "gdb-process-exited", "exit_code": self._exit_code}
        )

    async def _handle_record(self, record: dict[str, Any]) -> None:
        record_type = record.get("type")
        message = record.get("message")

        if record_type == "result":
            token = record.get("token")
            future = self._pending.get(token) if isinstance(token, int) else None
            if future is not None and not future.done():
                future.set_result(record)
            elif token is not None:
                logger.debug("late/orphan MI result (token=%s): %s", token, message)
            return

        if record_type == "notify":
            await self._handle_notify(record)
            return

        if record_type in {"console", "log", "output", "target"}:
            text = record.get("payload")
            if isinstance(text, str) and text:
                clean = text.rstrip("\n")
                self._recent_output.append(clean)
                self._queue_output(record_type, clean)
            return

        # Unknown record types are retained for diagnostics, never interpreted.
        self._recent_output.append(f"[unparsed] {record!r}")

    async def _handle_notify(self, record: dict[str, Any]) -> None:
        message = record.get("message")
        payload = record.get("payload") or {}

        if message == "stopped":
            self._state = "stopped"
            self._stop_epoch += 1
            self._last_stop = StopEvent(
                epoch=self._stop_epoch,
                reason=payload.get("reason"),
                payload=payload,
            )
            await self._notify_state()
            self._events.put_nowait(
                {"type": "stopped", "event": self._last_stop}
            )
            return

        if message == "running":
            self._state = "running"
            await self._notify_state()
            self._events.put_nowait({"type": "running"})
            return

        if message == "thread-group-started":
            pid = payload.get("pid")
            try:
                self.inferior_pid = int(str(pid)) if pid is not None else None
            except ValueError:
                self.inferior_pid = None
            self._inferior_starttime = (
                self._proc_starttime(self.inferior_pid)
                if self.inferior_pid is not None
                else None
            )
            return

        if message == "thread-group-exited":
            self._state = "exited"
            self._exit_epoch += 1
            self._exit_code = payload.get("exit-code")
            await self._notify_state()
            self._events.put_nowait(
                {
                    "type": "exited",
                    "reason": "thread-group-exited",
                    "exit_code": self._exit_code,
                }
            )
            return

        if message == "thread-exited":
            return

        # breakpoint-modified etc. are retained for logging only.

    async def _notify_state(self) -> None:
        async with self._state_condition:
            self._state_condition.notify_all()

    # ------------------------------------------------------------------ outputs
    async def next_event(self) -> dict[str, Any]:
        return await self._events.get()

    def recent_output(self, limit: int = 100) -> list[str]:
        return list(self._recent_output)[-limit:]
