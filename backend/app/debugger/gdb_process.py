"""Persistent GDB subprocess owned by one DebugSession.

pygdbmi's IoManager is used for MI parsing, but the process is spawned here so it
can get its own session/process group (cleanup) and a controlled environment.
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path

from pygdbmi.IoManager import IoManager

from app.core.config import Settings

MI_INTERPRETER_FLAG = "--interpreter=mi3"


class GdbProcessError(RuntimeError):
    """The GDB process could not be started or is no longer usable."""


def build_gdb_command(settings: Settings) -> list[str]:
    """Build the persistent GDB command from configured arguments."""
    args = [arg for arg in settings.gdb_args if arg not in {"--batch", "-batch"}]
    if not any(arg.startswith("--interpreter=mi") for arg in args):
        args.append(MI_INTERPRETER_FLAG)
    if "--quiet" not in args:
        args.insert(0, "--quiet")
    return [settings.gdb_binary, *args]


class GdbProcess:
    """A long-lived GDB/MI3 subprocess with blocking read/write primitives."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.command = build_gdb_command(settings)
        self._process: subprocess.Popen[bytes] | None = None
        self._io: IoManager | None = None

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process is not None else None

    @property
    def alive(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def start(self) -> int:
        if self._process is not None:
            raise GdbProcessError("GDB process is already running")
        executable = self.command[0]
        resolved = Path(executable)
        if not resolved.is_file():
            # A bare command name is resolved by the OS; a path must exist.
            if os.sep in executable or (os.altsep and os.altsep in executable):
                raise GdbProcessError(f"GDB executable not found: {executable}")

        env = os.environ.copy()
        env.setdefault("LC_ALL", "C")
        env.setdefault("LANG", "C")

        kwargs: dict[str, object] = {}
        if os.name == "posix":
            kwargs["start_new_session"] = True
        try:
            process = subprocess.Popen(
                self.command,
                shell=False,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                env=env,
                **kwargs,
            )
        except OSError as exc:
            raise GdbProcessError(
                f"Could not start GDB ({' '.join(self.command)}): {exc}"
            ) from exc

        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None
        self._process = process
        self._io = IoManager(
            process.stdin,
            process.stdout,
            process.stderr,
            time_to_check_for_additional_output_sec=0.1,
        )
        return process.pid

    def write(self, text: str) -> None:
        """Write one MI command line (no shell involved)."""
        if self._process is None or self._io is None:
            raise GdbProcessError("GDB process is not running")
        if self._process.poll() is not None:
            raise GdbProcessError("GDB process has exited")
        self._io.stdin.write((text.rstrip("\n") + "\n").encode("utf-8"))
        self._io.stdin.flush()

    def read(self, timeout: float = 0.2) -> list[dict]:
        """Block up to ``timeout`` seconds and return parsed MI records."""
        if self._io is None:
            return []
        try:
            return self._io.get_gdb_response(
                timeout_sec=timeout, raise_error_on_timeout=False
            )
        except Exception as exc:  # pygdbmi raises ValueError on closed pipes
            if self._process is None or self._process.poll() is not None:
                return []
            raise GdbProcessError(f"GDB read failed: {exc}") from exc

    def wait_exit(self, timeout: float) -> bool:
        if self._process is None:
            return True
        try:
            self._process.wait(timeout=timeout)
            return True
        except subprocess.TimeoutExpired:
            return False

    def kill(self) -> None:
        """Kill GDB and (on POSIX) its whole process group, including inferiors."""
        process = self._process
        if process is None or process.poll() is not None:
            return
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGKILL)
                return
            except (ProcessLookupError, PermissionError):
                pass
        try:
            process.kill()
        except ProcessLookupError:
            pass

    def close(self, *, timeout: float = 3.0) -> None:
        process = self._process
        if process is None:
            return
        try:
            if process.poll() is None:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
                if not self.wait_exit(timeout):
                    self.kill()
                    self.wait_exit(max(timeout, 1.0))
        finally:
            for stream in (process.stdin, process.stdout, process.stderr):
                try:
                    if stream is not None:
                        stream.close()
                except OSError:
                    pass
            self._process = None
            self._io = None


def sleep_briefly(seconds: float = 0.05) -> None:
    """Small helper kept for tests/session teardown timing."""
    time.sleep(seconds)
