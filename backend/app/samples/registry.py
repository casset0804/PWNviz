"""Teaching sample discovery.

A sample is a directory under ``samples/`` containing ``demo.c`` plus a compiled
``demo`` binary built by ``scripts/build_samples.sh``. Discovery never executes
anything; it only reports what exists on disk.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.schemas.common import utc_from_timestamp

SAMPLE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SOURCE_NAME = "demo.c"
BINARY_NAME = "demo"
README_NAME = "README.md"


@dataclass(frozen=True)
class SampleRecord:
    id: str
    title: str
    description: str | None
    directory: Path
    source_file: Path
    binary_file: Path

    @property
    def binary_exists(self) -> bool:
        return self.binary_file.is_file()

    @property
    def binary_size(self) -> int | None:
        return self.binary_file.stat().st_size if self.binary_exists else None

    @property
    def binary_built_at(self) -> str | None:
        if not self.binary_exists:
            return None
        return utc_from_timestamp(self.binary_file.stat().st_mtime)

    def build_command(self) -> list[str]:
        """Canonical teaching build command (mirrors scripts/build_samples.sh)."""
        return [
            "gcc",
            "-g",
            "-O0",
            "-fno-omit-frame-pointer",
            "-fno-inline",
            "-fno-pie",
            "-no-pie",
            "-o",
            str(self.binary_file),
            str(self.source_file),
        ]


def _read_readme(directory: Path) -> tuple[str | None, str | None]:
    """Return the first markdown heading and first paragraph of README.md."""
    path = directory / README_NAME
    if not path.is_file():
        return None, None
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None, None

    title: str | None = None
    description_parts: list[str] = []
    in_paragraph = False
    for raw in lines:
        line = raw.strip()
        if title is None and line.startswith("# "):
            title = line[2:].strip()
            continue
        if title is None:
            continue
        if not line:
            if in_paragraph:
                break
            continue
        if line.startswith(("#", "```", ">", "|", "- ", "* ")):
            if in_paragraph:
                break
            continue
        in_paragraph = True
        description_parts.append(line)

    description = " ".join(description_parts).strip() or None
    if description and len(description) > 400:
        description = description[:397].rstrip() + "..."
    return title, description


def discover_samples(samples_dir: Path) -> list[SampleRecord]:
    """Scan ``samples_dir`` for valid sample directories, sorted by id.

    Sample directories and their sources must resolve inside ``samples_dir`` so a
    symlink cannot point discovery outside the allowed sample root. Nothing found
    here is executed by the API.
    """
    if not samples_dir.is_dir():
        return []

    try:
        root = samples_dir.resolve()
    except OSError:
        return []

    records: list[SampleRecord] = []
    for child in sorted(samples_dir.iterdir(), key=lambda p: p.name):
        if not child.is_dir() or child.name.startswith("."):
            continue
        if not SAMPLE_ID_RE.match(child.name):
            continue
        try:
            resolved_child = child.resolve()
        except OSError:
            continue
        if not resolved_child.is_relative_to(root):
            continue
        source = child / SOURCE_NAME
        if not source.is_file():
            continue
        try:
            if not source.resolve().is_relative_to(root):
                continue
        except OSError:
            continue
        title, description = _read_readme(child)
        records.append(
            SampleRecord(
                id=child.name,
                title=title or child.name,
                description=description,
                directory=child,
                source_file=source,
                binary_file=child / BINARY_NAME,
            )
        )
    return records


def get_sample(samples_dir: Path, sample_id: str) -> SampleRecord | None:
    if not SAMPLE_ID_RE.match(sample_id):
        return None
    for record in discover_samples(samples_dir):
        if record.id == sample_id:
            return record
    return None
