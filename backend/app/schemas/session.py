"""Session request/response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.snapshot import Snapshot

ActionName = Literal[
    "launch",
    "run",
    "continue",
    "interrupt",
    "step_instruction",
    "next_instruction",
    "step",
    "next",
    "finish",
]


class CreateSessionRequest(BaseModel):
    sample_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$",
    )
    stop_at: str = Field(
        default="main",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z_][A-Za-z0-9_.]{0,127}$",
        description="Symbol used for the initial breakpoint (validated, never concatenated raw).",
    )
    load_pwndbg: bool | None = Field(
        default=None,
        description="Override PWNVIZ_LOAD_PWNDBG for this session.",
    )


class SessionInfo(BaseModel):
    session_id: str
    sample_id: str
    state: str
    created_at: str
    updated_at: str
    snapshot_count: int = 0
    gdb_pid: int | None = None
    inferior_pid: int | None = None
    last_error: str | None = None
    stop_reason: str | None = None


class ActionRequest(BaseModel):
    action: ActionName


class ActionResponse(BaseModel):
    session_id: str
    state: str
    snapshot: Snapshot | None = None
    message: str | None = None


class SnapshotsResponse(BaseModel):
    session_id: str
    count: int
    snapshots: list[Snapshot]
