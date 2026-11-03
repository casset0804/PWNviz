"""Unit tests for environment-variable configuration parsing."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "GDB_PATH",
        "PWNVIZ_GDB_BINARY",
        "PWNDBG_INIT",
        "PWNVIZ_PWNDBG_PATH",
        "ALLOWED_SAMPLE_DIR",
        "PWNVIZ_SAMPLES_DIR",
        "API_HOST",
        "API_PORT",
        "PWNVIZ_HOST",
        "PWNVIZ_PORT",
    ):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()


def test_gdb_path_is_public_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GDB_PATH", "/usr/bin/gdb-custom")
    settings = get_settings()

    assert settings.gdb_binary == "/usr/bin/gdb-custom"


def test_legacy_gdb_binary_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PWNVIZ_GDB_BINARY", "gdb-14")
    settings = get_settings()

    assert settings.gdb_binary == "gdb-14"


def test_gdb_path_wins_over_legacy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GDB_PATH", "/opt/gdb/bin/gdb")
    monkeypatch.setenv("PWNVIZ_GDB_BINARY", "gdb-14")
    settings = get_settings()

    assert settings.gdb_binary == "/opt/gdb/bin/gdb"


def test_pwndbg_init_accepts_file_or_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    gdbinit = tmp_path / "pwndbg" / "gdbinit.py"
    gdbinit.parent.mkdir()
    gdbinit.write_text("# fake\n", encoding="utf-8")

    monkeypatch.setenv("PWNDBG_INIT", str(gdbinit))
    assert get_settings().pwndbg_path == gdbinit

    get_settings.cache_clear()
    monkeypatch.setenv("PWNDBG_INIT", str(gdbinit.parent))
    assert get_settings().pwndbg_path == gdbinit.parent


def test_allowed_sample_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ALLOWED_SAMPLE_DIR", str(tmp_path / "custom-samples"))
    settings = get_settings()

    assert settings.samples_dir == tmp_path / "custom-samples"
    assert settings.allowed_sample_dir == settings.samples_dir


def test_api_host_and_port(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_HOST", "0.0.0.0")
    monkeypatch.setenv("API_PORT", "9123")
    settings = get_settings()

    assert settings.api_host == "0.0.0.0"
    assert settings.api_port == 9123


@pytest.mark.parametrize("raw", ["", "not-a-port", "0", "70000", "-1"])
def test_invalid_api_port_falls_back(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    monkeypatch.setenv("API_PORT", raw)
    assert get_settings().api_port == 8000


def test_defaults_do_not_hardcode_host_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()

    assert settings.gdb_binary == "gdb"
    assert settings.pwndbg_path is None
    assert settings.api_host == "127.0.0.1"
    assert settings.api_port == 8000
    assert settings.samples_dir == settings.repo_root / "samples"
