"""Snapshot data model returned by the Phase 1 debug pipeline.

Addresses and 64-bit values are always hex strings so a JavaScript client can
never lose precision by parsing them as Number.
"""

from __future__ import annotations

from typing import Literal

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


class VariableNode(BaseModel):
    """One DWARF-backed variable in the selected frame.

    ``source``/``confidence`` make the evidence boundary explicit: values and
    types here come from GDB's debug-info-backed variable objects, while
    ``target_*`` fields are bounded reads of the pointed-to memory.
    """

    name: str
    type: str
    value: str | None = None
    address: str | None = None
    location_kind: Literal[
        "memory", "register", "optimized_out", "unavailable", "unknown"
    ] = "unknown"
    source: str = "dwarf"
    confidence: str = "debug-info"
    kind: str = "scalar"
    is_argument: bool = False
    frame_level: int = 0
    children: list["VariableNode"] = Field(default_factory=list)
    string_value: str | None = None
    pointer_target: str | None = None
    target_readable: bool | None = None
    target_bytes: str | None = None
    target_string: str | None = None
    target_source: str | None = None


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
    variables: list[VariableNode] = Field(default_factory=list)
    variables_available: bool = False
    warnings: list[str] = Field(default_factory=list)
