"""Response models for sample discovery."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SampleInfo(BaseModel):
    id: str
    title: str
    description: str | None = None
    directory: str
    source_file: str
    binary_file: str
    binary_exists: bool
    binary_size: int | None = None
    binary_built_at: str | None = None
    build_command: list[str] = Field(default_factory=list)


class SamplesResponse(BaseModel):
    samples_dir: str
    count: int
    samples: list[SampleInfo]
