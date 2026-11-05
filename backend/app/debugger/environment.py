"""Real, on-host capability probing for the debugger stack.

Nothing here is cached or mocked: every probe spawns the configured ``gdb`` binary
(or inspects the filesystem) and reports what the host actually provides. When a
probe cannot run, the result says so explicitly instead of assuming success.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.core.proc import run_command

GDB_VERSION_RE = re.compile(r"GNU gdb \(([^)\n]*)\)\s*(\d+(?:\.\d+)+)", re.IGNORECASE)
GDB_PYTHON_MARKER = "PWNVIZ_GDBPYTHON="
PWNDBG_MARKER_RE = re.compile(r"PWNVIZ_PWNDBG_OK(?:\s+version=(\S+))?")
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

X86_64_MACHINE_ALIASES = frozenset({"x86_64", "amd64", "x64"})

# Optional pwndbg locations to *search*, never assumptions about the host. The
# real path should come from PWNDBG_INIT; these keep detection convenient.
PWNDBG_COMMON_DIRS = (
    "/opt/pwndbg",
    "/usr/share/pwndbg",
    "~/pwndbg",
    "~/.pwndbg",
)

PWNDBG_VERIFY_SCRIPT = (
    "import pwndbg as _p;"
    "_v=getattr(getattr(_p,'lib',None),'version',None);"
    "print('PWNVIZ_PWNDBG_OK version=%s' % getattr(_v,'__version__','unknown'))"
)


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from GDB/pwndbg console output."""
    return ANSI_RE.sub("", text)


def parse_gdb_version(output: str) -> str | None:
    """Extract the version number from ``gdb --version`` output."""
    match = GDB_VERSION_RE.search(output)
    return match.group(2) if match else None


def version_tuple(version: str | None) -> tuple[int, ...]:
    """Convert ``"12.1.0"`` / ``"14.2"`` into a comparable tuple."""
    if not version:
        return ()
    parts: list[int] = []
    for piece in version.split("."):
        digits = re.match(r"\d+", piece)
        if not digits:
            break
        parts.append(int(digits.group(0)))
    return tuple(parts)


def version_meets_minimum(version: str | None, minimum: tuple[int, int, int]) -> bool:
    """Compare dotted versions component-wise, tolerating missing components."""
    found = version_tuple(version)
    if not found:
        return False
    width = max(len(found), len(minimum))
    padded_found = found + (0,) * (width - len(found))
    padded_min = tuple(minimum) + (0,) * (width - len(minimum))
    return padded_found >= padded_min


@dataclass(frozen=True)
class ArchitectureProbe:
    """Host/target architecture facts used to gate the x86-64 MVP."""

    machine: str
    display: str
    is_x86_64: bool


def detect_architecture(machine: str | None = None) -> ArchitectureProbe:
    """Classify the current machine name without assuming it is x86-64."""
    raw = (machine if machine is not None else platform.machine()) or ""
    normalized = raw.strip()
    lowered = normalized.lower()
    is_x86_64 = lowered in X86_64_MACHINE_ALIASES
    display = "x86-64" if is_x86_64 else (normalized or "unknown")
    return ArchitectureProbe(machine=normalized, display=display, is_x86_64=is_x86_64)


@dataclass(frozen=True)
class GdbPythonProbe:
    available: bool
    version: str | None
    error: str | None


@dataclass(frozen=True)
class GdbProbe:
    available: bool
    path: str | None
    version: str | None
    version_raw: str | None
    minimum_version: str
    supported: bool
    supports_mi3: bool
    python: GdbPythonProbe
    error: str | None
    duration_ms: int | None


@dataclass(frozen=True)
class PwndbgProbe:
    status: str  # not_found | detected | verified | load_failed
    path: str | None
    gdbinit: str | None
    verified: bool
    version: str | None
    detail: str | None
    enabled: bool


async def _probe_gdb_python(settings: Settings) -> GdbPythonProbe:
    command = (
        "python import sys;"
        "print('%s' + sys.version.split()[0])" % GDB_PYTHON_MARKER
    )
    result = await run_command(
        [
            settings.gdb_binary,
            "--batch",
            "--nx",
            "--quiet",
            "-ex",
            command,
        ],
        timeout=settings.probe_timeout_seconds,
    )
    if result.spawn_error:
        return GdbPythonProbe(False, None, result.spawn_error)
    if result.timed_out:
        return GdbPythonProbe(
            False, None, f"GDB Python probe timed out after {settings.probe_timeout_seconds:g}s"
        )
    text = strip_ansi(result.combined_output())
    for line in text.splitlines():
        if line.strip().startswith(GDB_PYTHON_MARKER):
            return GdbPythonProbe(True, line.strip().split("=", 1)[1], None)
    return GdbPythonProbe(
        False,
        None,
        "GDB did not report an embedded Python; run `gdb -batch -ex \"python print(1)\"` to confirm.",
    )


async def _probe_mi3(settings: Settings) -> bool:
    """Prove GDB accepts ``--interpreter=mi3``.

    GDB 12.1 exits 0 even for an unknown interpreter name, so the check looks for
    the MI console record produced by a command executed under mi3 and rejects the
    "unrecognized" diagnostic.
    """
    marker = "PWNVIZ_MI3_OK"
    result = await run_command(
        [
            settings.gdb_binary,
            "--batch",
            "--nx",
            "--quiet",
            "--interpreter=mi3",
            "-ex",
            f"python print('{marker}')",
        ],
        timeout=settings.probe_timeout_seconds,
    )
    if result.spawn_error or result.timed_out or result.exit_code != 0:
        return False
    text = strip_ansi(result.combined_output())
    if "unrecognized" in text.lower():
        return False
    return marker in text


async def probe_gdb(settings: Settings) -> GdbProbe:
    """Probe the configured GDB binary: presence, version, Python and MI3."""
    minimum = ".".join(str(part) for part in settings.gdb_min_version)
    resolved = shutil.which(settings.gdb_binary)

    result = await run_command(
        [settings.gdb_binary, "--version"],
        timeout=settings.probe_timeout_seconds,
    )
    raw = strip_ansi(result.combined_output()).strip()
    version = parse_gdb_version(raw)

    if result.spawn_error:
        return GdbProbe(
            available=False,
            path=resolved,
            version=None,
            version_raw=None,
            minimum_version=minimum,
            supported=False,
            supports_mi3=False,
            python=GdbPythonProbe(False, None, "GDB binary could not be started"),
            error=(
                f"GDB binary {settings.gdb_binary!r} not found or not executable: "
                f"{result.spawn_error}. Install GDB (e.g. `sudo apt install gdb`) "
                "or set GDB_PATH."
            ),
            duration_ms=result.duration_ms,
        )

    if result.timed_out:
        return GdbProbe(
            available=False,
            path=resolved,
            version=None,
            version_raw=None,
            minimum_version=minimum,
            supported=False,
            supports_mi3=False,
            python=GdbPythonProbe(False, None, "probe timed out"),
            error=f"`gdb --version` timed out after {settings.probe_timeout_seconds:g}s",
            duration_ms=result.duration_ms,
        )

    if version is None:
        return GdbProbe(
            available=False,
            path=resolved,
            version=None,
            version_raw=raw[:500] or None,
            minimum_version=minimum,
            supported=False,
            supports_mi3=False,
            python=GdbPythonProbe(False, None, "version unknown"),
            error="Could not parse `gdb --version` output; is this really GDB?",
            duration_ms=result.duration_ms,
        )

    python_probe, supports_mi3 = await _probe_gdb_python(settings), await _probe_mi3(
        settings
    )
    supported = version_meets_minimum(version, settings.gdb_min_version)

    error = None
    if not supported:
        error = f"GDB {version} is older than the required {minimum}."
    elif not python_probe.available:
        error = (
            "GDB has no usable embedded Python interpreter; "
            "install the matching python3-gdb package."
        )

    return GdbProbe(
        available=True,
        path=resolved or settings.gdb_binary,
        version=version,
        version_raw=raw.splitlines()[0] if raw else None,
        minimum_version=minimum,
        supported=supported,
        supports_mi3=supports_mi3,
        python=python_probe,
        error=error,
        duration_ms=result.duration_ms,
    )


def _expand(path: str | Path, home: Path) -> Path:
    text = str(path)
    text = text.replace("${HOME}", str(home))
    if text.startswith("~"):
        text = str(home) + text[1:]
    return Path(os.path.expandvars(text)).resolve()


def _gdbinit_pwndbg_paths(home: Path) -> list[Path]:
    """Read ``~/.gdbinit`` and return pwndbg directories referenced by ``source``."""
    found: list[Path] = []
    gdbinit = home / ".gdbinit"
    if not gdbinit.is_file():
        return found
    try:
        text = gdbinit.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return found

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        for keyword in ("source -s ", "source "):
            if line.startswith(keyword):
                target = line[len(keyword):].strip().strip("'\"")
                candidate = _expand(target, home)
                if candidate.name == "gdbinit.py":
                    found.append(candidate.parent)
    return found


def pwndbg_candidates(settings: Settings, home: Path | None = None) -> list[Path]:
    """Return existing directories that contain a pwndbg ``gdbinit.py``."""
    home_dir = home or Path.home()
    raw_candidates: list[Path] = []

    if settings.pwndbg_path:
        raw_candidates.append(settings.pwndbg_path)
    for env_name in ("PWNDBG_INIT", "PWNVIZ_PWNDBG_PATH", "PWNDBG_GDB_PATH"):
        value = os.environ.get(env_name)
        if value:
            raw_candidates.append(Path(os.path.expandvars(value)))
    raw_candidates.extend(_gdbinit_pwndbg_paths(home_dir))
    raw_candidates.extend(_expand(p, home_dir) for p in PWNDBG_COMMON_DIRS)

    candidates: list[Path] = []
    seen: set[Path] = set()
    for raw in raw_candidates:
        path = _expand(raw, home_dir)
        # Accept both a directory and a path to gdbinit.py itself.
        if path.name == "gdbinit.py":
            path = path.parent
        if path in seen:
            continue
        seen.add(path)
        if (path / "gdbinit.py").is_file():
            candidates.append(path)
    return candidates


async def verify_pwndbg(
    gdbinit_dir: Path, settings: Settings, *, timeout: float | None = None
) -> PwndbgProbe:
    """Actually load pwndbg into a throwaway GDB and check the marker."""
    gdbinit = gdbinit_dir / "gdbinit.py"
    if any(
        ord(character) < 0x20 or ord(character) == 0x7F
        for character in str(gdbinit)
    ):
        return PwndbgProbe(
            status="load_failed",
            path=str(gdbinit_dir),
            gdbinit=str(gdbinit),
            verified=False,
            version=None,
            detail="pwndbg path contains control characters; native GDB is used.",
            enabled=settings.load_pwndbg,
        )
    budget = timeout if timeout is not None else settings.pwndbg_probe_timeout_seconds
    result = await run_command(
        [
            settings.gdb_binary,
            "--batch",
            "--nx",
            "--quiet",
            "-ex",
            f"source {gdbinit}",
            "-ex",
            f"python {PWNDBG_VERIFY_SCRIPT}",
        ],
        timeout=budget,
    )
    text = strip_ansi(result.combined_output())

    if result.timed_out:
        return PwndbgProbe(
            status="load_failed",
            path=str(gdbinit_dir),
            gdbinit=str(gdbinit),
            verified=False,
            version=None,
            detail=f"Loading pwndbg timed out after {budget:g}s; continuing with native GDB.",
            enabled=settings.load_pwndbg,
        )
    if result.spawn_error:
        return PwndbgProbe(
            status="load_failed",
            path=str(gdbinit_dir),
            gdbinit=str(gdbinit),
            verified=False,
            version=None,
            detail=f"Could not start GDB to verify pwndbg: {result.spawn_error}",
            enabled=settings.load_pwndbg,
        )

    match = PWNDBG_MARKER_RE.search(text)
    if match:
        version = match.group(1)
        if version == "unknown":
            version = None
        return PwndbgProbe(
            status="verified",
            path=str(gdbinit_dir),
            gdbinit=str(gdbinit),
            verified=True,
            version=version,
            detail="pwndbg loaded successfully in a verification GDB process.",
            enabled=settings.load_pwndbg,
        )

    tail = "\n".join(line for line in text.splitlines()[-6:] if line.strip())
    return PwndbgProbe(
        status="load_failed",
        path=str(gdbinit_dir),
        gdbinit=str(gdbinit),
        verified=False,
        version=None,
        detail=(
            "GDB started but pwndbg did not report loaded; native GDB remains usable. "
            f"Output tail: {tail[:600]}"
        ),
        enabled=settings.load_pwndbg,
    )


async def probe_pwndbg(settings: Settings, *, verify: bool = False) -> PwndbgProbe:
    """Detect pwndbg on disk and optionally prove it loads into GDB."""
    candidates = pwndbg_candidates(settings)
    if not candidates:
        return PwndbgProbe(
            status="not_found",
            path=None,
            gdbinit=None,
            verified=False,
            version=None,
            detail=(
                "No pwndbg gdbinit.py found via PWNDBG_INIT, PWNDBG_GDB_PATH, "
                "~/.gdbinit or common install directories. Native GDB is used."
            ),
            enabled=settings.load_pwndbg,
        )

    primary = candidates[0]
    if not verify:
        return PwndbgProbe(
            status="detected",
            path=str(primary),
            gdbinit=str(primary / "gdbinit.py"),
            verified=False,
            version=None,
            detail=(
                "pwndbg installation found on disk; not loaded by this probe. "
                "Use ?verify_pwndbg=true to prove it loads."
            ),
            enabled=settings.load_pwndbg,
        )

    return await verify_pwndbg(primary, settings)
