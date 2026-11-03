"""Small async helpers for running bounded host commands."""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence


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
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd) if cwd else None,
            env=child_env,
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
        process.kill()
        stdout_b, stderr_b = await process.communicate()

    return CommandResult(
        args=argv,
        exit_code=process.returncode,
        stdout=stdout_b.decode("utf-8", errors="replace"),
        stderr=stderr_b.decode("utf-8", errors="replace"),
        duration_ms=int((time.monotonic() - started) * 1000),
        timed_out=timed_out,
    )
