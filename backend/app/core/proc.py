"""Small async helpers for running bounded host commands."""

from __future__ import annotations

import asyncio
import os
import signal
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

KILL_DRAIN_TIMEOUT_SECONDS = 2.0


def _kill_process_tree(process: asyncio.subprocess.Process) -> None:
    """Kill the child and everything in its process group when possible.

    Probes start the child in a new session on POSIX, so a hung GDB wrapper cannot
    leave background helpers behind after a timeout.
    """
    if os.name == "posix" and process.pid:
        try:
            os.killpg(process.pid, signal.SIGKILL)
            return
        except (ProcessLookupError, PermissionError):
            pass
    try:
        process.kill()
    except ProcessLookupError:
        pass


@dataclass(frozen=True)
class CommandResult:
    """Outcome of a bounded subprocess invocation."""

    args: tuple[str, ...]
    exit_code: int | None
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool
    spawn_error: str | None = None

    @property
    def ok(self) -> bool:
        return (
            self.spawn_error is None
            and not self.timed_out
            and self.exit_code == 0
        )

    def combined_output(self) -> str:
        parts = [part for part in (self.stdout, self.stderr) if part]
        return "\n".join(parts)


async def run_command(
    args: Sequence[str],
    *,
    timeout: float,
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
) -> CommandResult:
    """Run ``args`` without a shell and capture bounded stdout/stderr.

    A timeout kills the child process; the caller gets ``timed_out=True`` instead
    of an exception so capability probing can report partial results.
    """
    argv = tuple(str(part) for part in args)
    started = time.monotonic()

    child_env = None
    if env is not None:
        child_env = os.environ.copy()
        child_env.update(env)

    try:
        spawn_kwargs: dict[str, object] = {}
        if os.name == "posix":
            spawn_kwargs["start_new_session"] = True
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd) if cwd else None,
            env=child_env,
            **spawn_kwargs,
        )
    except (FileNotFoundError, PermissionError, OSError) as exc:
        return CommandResult(
            args=argv,
            exit_code=None,
            stdout="",
            stderr="",
            duration_ms=int((time.monotonic() - started) * 1000),
            timed_out=False,
            spawn_error=f"{type(exc).__name__}: {exc}",
        )

    timed_out = False
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            process.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        timed_out = True
        _kill_process_tree(process)
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                process.communicate(), timeout=KILL_DRAIN_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            # Grandchildren may still hold the pipes; do not hang the request.
            stdout_b, stderr_b = b"", b""
            try:
                await asyncio.wait_for(process.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass

    return CommandResult(
        args=argv,
        exit_code=process.returncode,
        stdout=stdout_b.decode("utf-8", errors="replace"),
        stderr=stderr_b.decode("utf-8", errors="replace"),
        duration_ms=int((time.monotonic() - started) * 1000),
        timed_out=timed_out,
    )
