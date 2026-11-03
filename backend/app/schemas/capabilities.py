"""Response models for ``GET /api/v1/capabilities``."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PwndbgStatus = Literal["not_found", "detected", "verified", "load_failed"]


class PlatformInfo(BaseModel):
    system: str
    release: str
    machine: str
    hostname: str


class PythonInfo(BaseModel):
    backend_version: str
    gdb_embedded_version: str | None = None


class GdbPythonInfo(BaseModel):
    available: bool
    version: str | None = None
    error: str | None = None


class GdbInfo(BaseModel):
    available: bool
    path: str | None = None
    version: str | None = None
    minimum_version: str
    supported: bool
    supports_mi3: bool
    python: GdbPythonInfo
    error: str | None = None
    duration_ms: int | None = None


class PwndbgInfo(BaseModel):
    status: PwndbgStatus
    path: str | None = None
    gdbinit: str | None = None
    verified: bool = False
    version: str | None = None
    detail: str | None = None
    enabled: bool = True


class SamplesSummary(BaseModel):
    directory: str
    count: int


class CapabilitiesResponse(BaseModel):
    generated_at: str
    service_version: str
    platform: PlatformInfo
    python: PythonInfo
    gdb: GdbInfo
    pwndbg: PwndbgInfo
    samples: SamplesSummary
    ready: bool = Field(
        description="True when a real GDB/MI3 session can be created on this host."
    )
    warnings: list[str] = Field(default_factory=list)
