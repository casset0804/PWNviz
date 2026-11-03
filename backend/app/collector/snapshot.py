"""Assemble one immutable debugger snapshot from a stopped GDB session."""

from __future__ import annotations

from app.analysis.diff import MemoryDiffEngine
from app.collector.common import parse_hex_int
from app.collector.disassembly import DisassemblyCollector
from app.collector.frames import FrameCollector
from app.collector.memory import StackMemoryCollector
from app.collector.registers import RegisterCollector
from app.core.config import Settings
from app.debugger.environment import detect_architecture
from app.debugger.mi_controller import MIController
from app.schemas.common import utc_now_iso
from app.schemas.snapshot import Snapshot, StackWindow


class SnapshotCollector:
    """Collect registers, frames, disassembly, memory and diff for one stop."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.registers = RegisterCollector()
        self.frames = FrameCollector(settings.snapshot_max_frames)
        self.memory = StackMemoryCollector(settings)
        self.disassembly = DisassemblyCollector(settings)

    async def collect(
        self,
        controller: MIController,
        *,
        session_id: str,
        snapshot_id: int,
        stop_reason: str | None,
        previous: Snapshot | None,
    ) -> Snapshot:
        warnings: list[str] = []

        registers: dict[str, str | None] = {}
        try:
            registers, register_warnings = await self.registers.collect(controller)
            warnings.extend(register_warnings)
        except Exception as exc:  # never let one section kill the snapshot
            warnings.append(f"Register collection failed: {type(exc).__name__}: {exc}")

        rip = parse_hex_int(registers.get("rip"))
        rsp = parse_hex_int(registers.get("rsp"))
        rbp = parse_hex_int(registers.get("rbp"))

        frames = []
        try:
            frames, frame_warnings = await self.frames.collect(controller)
            warnings.extend(frame_warnings)
        except Exception as exc:
            warnings.append(f"Frame collection failed: {type(exc).__name__}: {exc}")

        instruction = None
        disassembly = []
        try:
            instruction, disassembly, disasm_warnings = (
                await self.disassembly.collect(controller, rip)
            )
            warnings.extend(disasm_warnings)
        except Exception as exc:
            warnings.append(f"Disassembly failed: {type(exc).__name__}: {exc}")

        stack = None
        try:
            stack, memory_warnings = await self.memory.collect(
                controller, rsp=rsp, rbp=rbp, rip=rip
            )
            warnings.extend(memory_warnings)
        except Exception as exc:
            warnings.append(f"Stack memory failed: {type(exc).__name__}: {exc}")

        if stack is None:
            stack = StackWindow()

        diff = MemoryDiffEngine.compute(previous, registers, stack)
        MemoryDiffEngine.apply_highlights(diff, stack)

        # De-duplicate warnings while preserving order.
        unique_warnings: list[str] = []
        for warning in warnings:
            if warning and warning not in unique_warnings:
                unique_warnings.append(warning)

        return Snapshot(
            session_id=session_id,
            snapshot_id=snapshot_id,
            timestamp=utc_now_iso(),
            state="STOPPED",
            stop_reason=stop_reason,
            architecture=detect_architecture().display,
            endianness="little",
            pointer_bits=64,
            registers=registers,
            frames=frames,
            instruction=instruction,
            disassembly=disassembly,
            stack=stack,
            diff=diff,
            warnings=unique_warnings,
        )
