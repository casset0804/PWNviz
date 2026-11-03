"""Snapshot data model returned by the Phase 1 debug pipeline.

Addresses and 64-bit values are always hex strings so a JavaScript client can
never lose precision by parsing them as Number.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class FrameModel(BaseModel):
    level: int
    address: str | None = None
    function: str | None = None
    file: str | None = None
    line: int | None = None


class InstructionModel(BaseModel):
    address: str
    bytes: str | None = None
    mnemonic: str | None = None
    operands: str | None = None
    text: str | None = None
    function: str | None = None


class DisassemblyItem(BaseModel):
    address: str
    text: str
    is_current: bool = False
    function: str | None = None


class StackRow(BaseModel):
    address: str
    bytes: list[str | None] = Field(
        default_factory=list,
        description="Eight byte cells; null means the byte could not be read.",
    )
    readable: bool = False
    qword_le: str | None = None
    ascii: str | None = None
    annotations: list[str] = Field(default_factory=list)
    changed_byte_offsets: list[int] = Field(default_factory=list)


class UnreadableRange(BaseModel):
    start: str
    end: str


class StackWindow(BaseModel):
    range_start: str | None = None
    range_end: str | None = None
    word_size: int = 8
    rows: list[StackRow] = Field(default_factory=list)
    unreadable_ranges: list[UnreadableRange] = Field(default_factory=list)


class MemoryChange(BaseModel):
    address: str
    before: str | None = None
    after: str | None = None


class SnapshotDiff(BaseModel):
    previous_snapshot_id: int | None = None
    changed_registers: list[str] = Field(default_factory=list)
    changed_bytes: list[MemoryChange] = Field(default_factory=list)
    window_changed: bool = False


class Snapshot(BaseModel):
    session_id: str
    snapshot_id: int
    timestamp: str
    state: str
    stop_reason: str | None = None
    architecture: str = "x86-64"
    endianness: str = "little"
    pointer_bits: int = 64
    registers: dict[str, str | None] = Field(default_factory=dict)
    frames: list[FrameModel] = Field(default_factory=list)
    instruction: InstructionModel | None = None
    disassembly: list[DisassemblyItem] = Field(default_factory=list)
    stack: StackWindow = Field(default_factory=StackWindow)
    diff: SnapshotDiff = Field(default_factory=SnapshotDiff)
    warnings: list[str] = Field(default_factory=list)
