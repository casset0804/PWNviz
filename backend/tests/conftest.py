"""Shared pytest fixtures for the PWNviz backend."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.api.routes_capabilities import reset_capability_cache
from app.core.config import BACKEND_ROOT, REPO_ROOT, Settings, get_settings


@pytest.fixture(autouse=True)
def _fresh_settings() -> None:
    """Give each test a settings object free of cross-test cache state."""
    get_settings.cache_clear()
    reset_capability_cache()
    yield
    get_settings.cache_clear()
    reset_capability_cache()


@pytest.fixture
def settings() -> Settings:
    return get_settings()


@pytest.fixture
def make_settings(tmp_path: Path):
    """Factory producing bespoke Settings objects for probe tests."""

    def _make(**overrides: object) -> Settings:
        base = Settings(
            backend_root=BACKEND_ROOT,
            repo_root=REPO_ROOT,
            samples_dir=tmp_path / "samples",
            gdb_binary="gdb",
            gdb_min_version=(12, 1, 0),
            pwndbg_path=None,
            load_pwndbg=True,
            probe_timeout_seconds=5.0,
            pwndbg_probe_timeout_seconds=5.0,
            capabilities_cache_seconds=30.0,
            allowed_origins=("http://localhost:5173",),
            log_level="INFO",
        )
        return Settings(**{**base.__dict__, **overrides})

    return _make
