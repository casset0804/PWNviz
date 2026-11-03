"""Optional pwndbg initialisation.

pwndbg is an enhancement, never a dependency: a failed load becomes a warning and
native GDB debugging continues.
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import Settings
from app.core.logging import get_logger
from app.debugger.environment import pwndbg_candidates
from app.debugger.mi_controller import MIController, MIError

logger = get_logger("pwnviz.pwndbg")


def quote_gdb_path(path: Path) -> str:
    """Return the path unchanged for GDB's CLI ``source`` command.

    GDB 12.1's ``source`` does not strip double quotes (it looks for a file whose
    name contains them), so a raw path is correct. Paths with whitespace are not
    representable safely here and degrade to a warning.
    """
    return str(path)


def _mi_quote(text: str) -> str:
    """Quote one MI command argument."""
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def find_pwndbg_init(settings: Settings) -> Path | None:
    if settings.pwndbg_path is not None:
        candidate = settings.pwndbg_path
        if candidate.name == "gdbinit.py":
            return candidate if candidate.is_file() else None
        script = candidate / "gdbinit.py"
        return script if script.is_file() else None
    candidates = pwndbg_candidates(settings)
    return candidates[0] / "gdbinit.py" if candidates else None


async def load_pwndbg(
    controller: MIController, settings: Settings, *, enabled: bool
) -> list[str]:
    if not enabled:
        return []
    gdbinit = find_pwndbg_init(settings)
    if gdbinit is None:
        return ["pwndbg was not found; the session uses native GDB."]
    if any(character in str(gdbinit) for character in "\r\n"):
        return ["pwndbg path contains control characters; native GDB is used."]
    if any(character.isspace() for character in str(gdbinit)):
        return [
            "pwndbg path contains whitespace and cannot be sourced safely; "
            "native GDB is used."
        ]
    cli_command = f"source {quote_gdb_path(gdbinit)}"
    command = f"-interpreter-exec console {_mi_quote(cli_command)}"
    try:
        await controller.execute(
            command, timeout=settings.pwndbg_probe_timeout_seconds
        )
    except MIError as exc:
        logger.warning("pwndbg load failed: %s", exc)
        return [f"pwndbg failed to load; native GDB is used. ({exc})"]
    return []
