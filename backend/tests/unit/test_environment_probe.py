"""Unit tests for capability parsing and detection helpers (no GDB required)."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest

from app.debugger.environment import (
    parse_gdb_version,
    pwndbg_candidates,
    strip_ansi,
    verify_pwndbg,
    version_meets_minimum,
)

GDB_12_OUTPUT = """\
GNU gdb (Ubuntu 12.1-0ubuntu1~22.04.2) 12.1
Copyright (C) 2022 Free Software Foundation, Inc.
License GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>
"""


def test_parse_gdb_version_ubuntu_string() -> None:
    assert parse_gdb_version(GDB_12_OUTPUT) == "12.1"


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("GNU gdb (GDB) 14.2", "14.2"),
        ("GNU gdb (Debian 13.1-2) 13.1", "13.1"),
        ("GNU gdb (GDB; openSUSE Leap 15.5) 12.1.0", "12.1.0"),
        ("gdb: command not found", None),
        ("", None),
    ],
)
def test_parse_gdb_version_variants(line: str, expected: str | None) -> None:
    assert parse_gdb_version(line) == expected


@pytest.mark.parametrize(
    ("version", "minimum", "expected"),
    [
        ("12.1", (12, 1, 0), True),
        ("12.0", (12, 1, 0), False),
        ("13", (12, 1, 0), True),
        ("12.1.1", (12, 1, 0), True),
        (None, (12, 1, 0), False),
        ("", (12, 1, 0), False),
    ],
)
def test_version_meets_minimum(
    version: str | None, minimum: tuple[int, int, int], expected: bool
) -> None:
    assert version_meets_minimum(version, minimum) is expected


def test_strip_ansi() -> None:
    assert strip_ansi("\x1b[31mpwndbg\x1b[0m: loaded") == "pwndbg: loaded"


def test_pwndbg_candidates_reads_gdbinit(
    tmp_path: Path, make_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    pwndbg_dir = tmp_path / "tools" / "pwndbg"
    pwndbg_dir.mkdir(parents=True)
    (pwndbg_dir / "gdbinit.py").write_text("# fake\n", encoding="utf-8")
    home.mkdir()
    (home / ".gdbinit").write_text(
        f"source {pwndbg_dir}/gdbinit.py\n", encoding="utf-8"
    )
    monkeypatch.delenv("PWNVIZ_PWNDBG_PATH", raising=False)
    monkeypatch.delenv("PWNDBG_GDB_PATH", raising=False)

    candidates = pwndbg_candidates(make_settings(), home=home)

    assert pwndbg_dir.resolve() in candidates


def test_pwndbg_candidates_empty_when_absent(
    tmp_path: Path, make_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.delenv("PWNVIZ_PWNDBG_PATH", raising=False)
    monkeypatch.delenv("PWNDBG_GDB_PATH", raising=False)
    monkeypatch.setattr("app.debugger.environment.PWNDBG_COMMON_DIRS", ())

    assert pwndbg_candidates(make_settings(), home=home) == []


def _fake_gdb(tmp_path: Path, body: str) -> Path:
    script = tmp_path / "fake-gdb"
    script.write_text("#!/usr/bin/env bash\n" + body + "\n", encoding="utf-8")
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
    return script


async def test_verify_pwndbg_detects_marker(tmp_path: Path, make_settings) -> None:
    gdb = _fake_gdb(
        tmp_path,
        "echo 'PWNVIZ_PWNDBG_OK version=2025.01.01'\nexit 0",
    )
    pwndbg_dir = tmp_path / "pwndbg"
    pwndbg_dir.mkdir()
    (pwndbg_dir / "gdbinit.py").write_text("# fake\n", encoding="utf-8")

    probe = await verify_pwndbg(pwndbg_dir, make_settings(gdb_binary=str(gdb)))

    assert probe.verified is True
    assert probe.status == "verified"
    assert probe.version == "2025.01.01"


async def test_verify_pwndbg_reports_failure(tmp_path: Path, make_settings) -> None:
    gdb = _fake_gdb(tmp_path, "echo 'python interpreter missing' >&2\nexit 1")
    pwndbg_dir = tmp_path / "pwndbg"
    pwndbg_dir.mkdir()
    (pwndbg_dir / "gdbinit.py").write_text("# fake\n", encoding="utf-8")

    probe = await verify_pwndbg(pwndbg_dir, make_settings(gdb_binary=str(gdb)))

    assert probe.verified is False
    assert probe.status == "load_failed"
    assert "python interpreter missing" in (probe.detail or "")


async def test_verify_pwndbg_timeout(tmp_path: Path, make_settings) -> None:
    gdb = _fake_gdb(tmp_path, "sleep 5")
    pwndbg_dir = tmp_path / "pwndbg"
    pwndbg_dir.mkdir()
    (pwndbg_dir / "gdbinit.py").write_text("# fake\n", encoding="utf-8")

    probe = await verify_pwndbg(
        pwndbg_dir, make_settings(gdb_binary=str(gdb)), timeout=0.2
    )

    assert probe.status == "load_failed"
    assert "timed out" in (probe.detail or "")


async def test_probe_gdb_missing_binary(make_settings) -> None:
    from app.debugger.environment import probe_gdb

    probe = await probe_gdb(make_settings(gdb_binary="pwnviz-no-such-gdb-xyz"))

    assert probe.available is False
    assert probe.supported is False
    assert probe.error
    assert "not found" in probe.error or "No such file" in probe.error
