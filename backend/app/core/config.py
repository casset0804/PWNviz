"""Process-wide configuration loaded from environment variables / ``.env``.

Public configuration names are documented in ``.env.example``:
``GDB_PATH``, ``PWNDBG_INIT``, ``API_HOST``, ``API_PORT``, ``ALLOWED_SAMPLE_DIR``.
Legacy ``PWNVIZ_*`` names are still honoured as fallbacks. The settings object is
immutable and cached so every request sees the same view of the environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

from app.core.security import is_loopback_host

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

DEFAULT_GDB_MIN_VERSION = (12, 1, 0)
DEFAULT_API_HOST = "127.0.0.1"
DEFAULT_API_PORT = 8000
DEFAULT_ALLOWED_HOSTS = ("127.0.0.1", "localhost", "testserver")
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _first_env(*names: str) -> str | None:
    """Return the first non-empty environment value among ``names``."""
    for name in names:
        raw = os.environ.get(name)
        if raw is not None and raw.strip() != "":
            return raw.strip()
    return None


def _env_str(names: tuple[str, ...], default: str) -> str:
    raw = _first_env(*names)
    return default if raw is None else raw


def _env_bool(names: tuple[str, ...], default: bool) -> bool:
    raw = _first_env(*names)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _env_float(names: tuple[str, ...], default: float) -> float:
    raw = _first_env(*names)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _env_int(names: tuple[str, ...], default: int) -> int:
    raw = _first_env(*names)
    if raw is None:
        return default
    try:
        return int(raw, 0)
    except ValueError:
        return default


def _env_port(default: int = DEFAULT_API_PORT) -> int:
    """Parse ``API_PORT``/``PWNVIZ_PORT`` and ignore out-of-range values."""
    raw = _first_env("API_PORT", "PWNVIZ_PORT")
    if raw is None:
        return default
    try:
        port = int(raw, 10)
    except ValueError:
        return default
    return port if 1 <= port <= 65535 else default


def _env_path(names: tuple[str, ...], default: Path) -> Path:
    raw = _first_env(*names)
    if raw is None:
        return default
    return Path(os.path.expandvars(os.path.expanduser(raw)))


def _env_origins(names: tuple[str, ...], default: tuple[str, ...]) -> tuple[str, ...]:
    raw = _first_env(*names)
    if raw is None:
        return default
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    """Immutable runtime configuration for the PWNviz backend."""

    backend_root: Path
    repo_root: Path
    samples_dir: Path
    allowed_sample_dir: Path
    gdb_binary: str
    gdb_min_version: tuple[int, int, int]
    pwndbg_path: Path | None
    load_pwndbg: bool
    api_host: str
    api_port: int
    allow_remote: bool
    allowed_hosts: tuple[str, ...]
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
            "allowed_sample_dir": str(self.allowed_sample_dir),
            "gdb_binary": self.gdb_binary,
            "pwndbg_path": str(self.pwndbg_path) if self.pwndbg_path else None,
            "load_pwndbg": self.load_pwndbg,
            "api_host": self.api_host,
            "api_port": self.api_port,
            "allow_remote": self.allow_remote,
            "allowed_hosts": list(self.allowed_hosts),
            "log_level": self.log_level,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load ``.env`` (if present) and build the cached settings object."""
    if not _env_bool(("PWNVIZ_DISABLE_DOTENV",), False):
        load_dotenv(REPO_ROOT / ".env", override=False)

    pwndbg_raw = _first_env("PWNDBG_INIT", "PWNVIZ_PWNDBG_PATH")
    pwndbg_path = (
        Path(os.path.expandvars(os.path.expanduser(pwndbg_raw)))
        if pwndbg_raw
        else None
    )

    samples_dir = _env_path(
        ("ALLOWED_SAMPLE_DIR", "PWNVIZ_SAMPLES_DIR"), REPO_ROOT / "samples"
    )

    api_host = _env_str(("API_HOST", "PWNVIZ_HOST"), DEFAULT_API_HOST)
    default_hosts = list(DEFAULT_ALLOWED_HOSTS)
    if api_host not in {"0.0.0.0", "::", "[::]"} and not is_loopback_host(api_host):
        if api_host not in default_hosts:
            default_hosts.append(api_host)

    return Settings(
        backend_root=BACKEND_ROOT,
        repo_root=REPO_ROOT,
        samples_dir=samples_dir,
        allowed_sample_dir=samples_dir,
        gdb_binary=_env_str(("GDB_PATH", "PWNVIZ_GDB_BINARY"), "gdb"),
        gdb_min_version=DEFAULT_GDB_MIN_VERSION,
        pwndbg_path=pwndbg_path,
        load_pwndbg=_env_bool(("PWNVIZ_LOAD_PWNDBG",), True),
        api_host=api_host,
        api_port=_env_port(),
        allow_remote=_env_bool(("PWNVIZ_ALLOW_REMOTE",), False),
        allowed_hosts=_env_origins(
            ("PWNVIZ_ALLOWED_HOSTS",), tuple(default_hosts)
        ),
        probe_timeout_seconds=_env_float(("PWNVIZ_PROBE_TIMEOUT_SECONDS",), 10.0),
        pwndbg_probe_timeout_seconds=_env_float(
            ("PWNVIZ_PWNDBG_PROBE_TIMEOUT_SECONDS",), 45.0
        ),
        capabilities_cache_seconds=_env_float(
            ("PWNVIZ_CAPABILITIES_CACHE_SECONDS",), 30.0
        ),
        allowed_origins=_env_origins(
            ("PWNVIZ_ALLOWED_ORIGINS",), DEFAULT_ALLOWED_ORIGINS
        ),
        log_level=_env_str(("PWNVIZ_LOG_LEVEL",), "INFO").upper(),
        stack_window_below=_env_int(("PWNVIZ_STACK_WINDOW_BELOW",), 0x80),
        stack_window_above=_env_int(("PWNVIZ_STACK_WINDOW_ABOVE",), 0x180),
        max_stack_read_bytes=_env_int(("PWNVIZ_MAX_STACK_READ_BYTES",), 0x400),
    )
