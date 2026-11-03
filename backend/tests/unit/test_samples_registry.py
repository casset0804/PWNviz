"""Unit tests for teaching sample discovery."""

from __future__ import annotations

from pathlib import Path

from app.samples.registry import discover_samples, get_sample

SAMPLE_SOURCE = """\
#include <stdio.h>
int main(void) { return 0; }
"""


def _make_sample(root: Path, name: str, *, readme: str | None = None) -> Path:
    directory = root / name
    directory.mkdir(parents=True)
    (directory / "demo.c").write_text(SAMPLE_SOURCE, encoding="utf-8")
    if readme is not None:
        (directory / "README.md").write_text(readme, encoding="utf-8")
    return directory


def test_discover_filters_invalid_entries(tmp_path: Path) -> None:
    samples = tmp_path / "samples"
    samples.mkdir()
    _make_sample(samples, "stack-basic")
    (samples / "no-source").mkdir()
    (samples / "Bad Name").mkdir()
    (samples / "Bad Name" / "demo.c").write_text(SAMPLE_SOURCE, encoding="utf-8")
    (samples / ".hidden").mkdir()
    (samples / ".hidden" / "demo.c").write_text(SAMPLE_SOURCE, encoding="utf-8")

    records = discover_samples(samples)

    assert [record.id for record in records] == ["stack-basic"]


def test_discover_missing_directory_returns_empty(tmp_path: Path) -> None:
    assert discover_samples(tmp_path / "does-not-exist") == []


def test_readme_title_and_description(tmp_path: Path) -> None:
    samples = tmp_path / "samples"
    samples.mkdir()
    _make_sample(
        samples,
        "stack-basic",
        readme=(
            "# stack-basic\n"
            "\n"
            "First teaching sample: a tiny function call.\n"
            "Second line of the same paragraph.\n"
            "\n"
            "## Details\n"
            "ignored\n"
        ),
    )

    [record] = discover_samples(samples)

    assert record.title == "stack-basic"
    assert record.description == (
        "First teaching sample: a tiny function call. Second line of the same paragraph."
    )


def test_binary_state_and_build_command(tmp_path: Path) -> None:
    samples = tmp_path / "samples"
    samples.mkdir()
    directory = _make_sample(samples, "stack-basic")

    [record] = discover_samples(samples)
    assert record.binary_exists is False
    assert record.binary_size is None
    assert record.binary_built_at is None

    binary = directory / "demo"
    binary.write_bytes(b"\x7fELF" + b"\x00" * 60)

    [record] = discover_samples(samples)
    assert record.binary_exists is True
    assert record.binary_size == 64
    assert record.binary_built_at is not None

    command = record.build_command()
    assert command[0] == "gcc"
    assert "-g" in command and "-O0" in command
    assert "-fno-omit-frame-pointer" in command
    assert "-no-pie" in command
    assert command[-1] == str(record.source_file)
    assert command[-2] == str(record.binary_file)
    assert command[-3] == "-o"


def test_get_sample_rejects_traversal(tmp_path: Path) -> None:
    samples = tmp_path / "samples"
    samples.mkdir()
    _make_sample(samples, "stack-basic")

    assert get_sample(samples, "stack-basic") is not None
    assert get_sample(samples, "../stack-basic") is None
    assert get_sample(samples, "unknown") is None
