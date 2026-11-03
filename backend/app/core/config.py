"""Process-wide configuration loaded from environment variables / ``.env``.

Secrets and host paths are kept out of code. The settings object is immutable and
cached so every request sees the same view of the environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

DEFAULT_GDB_MIN_VERSION = (12, 1, 0)
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw, 0)
    except ValueError:
        return default


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return Path(os.path.expandvars(os.path.expanduser(raw.strip())))


def _env_origins(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    """Immutable runtime configuration for the PWNviz backend."""

    backend_root: Path
    repo_root: Path
    samples_dir: Path
    gdb_binary: str
    gdb_min_version: tuple[int, int, int]
    pwndbg_path: Path | None
    load_pwndbg: bool
    probe_timeout_seconds: float
    pwndbg_probe_timeout_seconds: float
    capabilities_cache_seconds: float
    allowed_origins: tuple[str, ...]
    log_level: str

    # Phase 1 knobs; stored here so the collector and API agree on limits.
    stack_window_below: int = 0x80
    stack_window_above: int = 0x180
    max_stack_read_bytes: int = 0x400

    def describe(self) -> dict[str, object]:
        """Safe-to-log view of the settings (no secrets involved)."""
        return {
            "repo_root": str(self.repo_root),
            "samples_dir": str(self.samples_dir),
            "gdb_binary": self.gdb_binary,
            "pwndbg_path": str(self.pwndbg_path) if self.pwndbg_path else None,
            "load_pwndbg": self.load_pwndbg,
            "log_level": self.log_level,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load ``.env`` (if present) and build the cached settings object."""
    load_dotenv(REPO_ROOT / ".env", override=False)

    pwndbg_env = os.environ.get("PWNVIZ_PWNDBG_PATH", "").strip()
    pwndbg_path = (
        Path(os.path.expandvars(os.path.expanduser(pwndbg_env))) if pwndbg_env else None
    )

    return Settings(
        backend_root=BACKEND_ROOT,
        repo_root=REPO_ROOT,
        samples_dir=_env_path("PWNVIZ_SAMPLES_DIR", REPO_ROOT / "samples"),
        gdb_binary=_env_str("PWNVIZ_GDB_BINARY", "gdb"),
        gdb_min_version=DEFAULT_GDB_MIN_VERSION,
        pwndbg_path=pwndbg_path,
        load_pwndbg=_env_bool("PWNVIZ_LOAD_PWNDBG", True),
        probe_timeout_seconds=_env_float("PWNVIZ_PROBE_TIMEOUT_SECONDS", 10.0),
        pwndbg_probe_timeout_seconds=_env_float(
            "PWNVIZ_PWNDBG_PROBE_TIMEOUT_SECONDS", 45.0
        ),
        capabilities_cache_seconds=_env_float(
            "PWNVIZ_CAPABILITIES_CACHE_SECONDS", 30.0
        ),
        allowed_origins=_env_origins("PWNVIZ_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS),
        log_level=_env_str("PWNVIZ_LOG_LEVEL", "INFO").upper(),
        stack_window_below=_env_int("PWNVIZ_STACK_WINDOW_BELOW", 0x80),
        stack_window_above=_env_int("PWNVIZ_STACK_WINDOW_ABOVE", 0x180),
        max_stack_read_bytes=_env_int("PWNVIZ_MAX_STACK_READ_BYTES", 0x400),
    )
