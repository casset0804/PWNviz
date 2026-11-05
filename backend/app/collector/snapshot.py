"""Assemble one immutable debugger snapshot from a stopped GDB session.

Two collection modes are supported and both collect real data from GDB:

``fast`` (the default between steps)
    registers, stack memory + byte diff, the current instruction from the cached
    disassembly window, and cached frames that are explicitly labelled as cached.
    Variables are refreshed in place with one ``-var-update`` so their values stay
    current without rebuilding the tree; with no cached tree the block is
    labelled ``deferred`` instead of guessing.

``full`` (launch and explicit refreshes)
    everything in ``fast`` plus a forced frame unwind, a fresh disassembly
    window, and a full DWARF variable collection that reuses existing GDB
    variable objects where possible.

Neither mode skips a failure path or substitutes mock data: a section that
fails still produces a warning and an honest empty/unknown value.
"""

from __future__ import annotations

from app.analysis.diff import MemoryDiffEngine
from app.analysis.perf import PerfRecorder
from app.collector.common import parse_hex_int
from app.collector.disassembly import DisassemblyCollector
from app.collector.frames import FrameCollector
from app.collector.memory import StackMemoryCollector
from app.collector.registers import RegisterCollector
from app.collector.variables import VariableCollector
from app.core.config import Settings
from app.debugger.environment import detect_architecture
from app.debugger.mi_controller import MIController
from app.schemas.common import utc_now_iso
from app.schemas.snapshot import (
    DisassemblyItem,
    FrameModel,
    InstructionModel,
    Snapshot,
    SnapshotDiff,
    StackWindow,
    VariableNode,
)


def previous_mnemonic(previous: Snapshot | None) -> str | None:
    """Mnemonic of the instruction that led to this stop, if it is known.

    ``previous.instruction`` is ``None`` whenever disassembly failed for that
    stop, so the snapshot itself existing is not enough evidence. Returning
    ``None`` lets the frame collector fall back to the safety interval instead
    of aborting the whole snapshot.
    """
    instruction = previous.instruction if previous is not None else None
    return instruction.mnemonic if instruction is not None else None


class SnapshotCollector:
    """Collect registers, frames, disassembly, memory and diff for one stop."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.registers = RegisterCollector()
        self.frames = FrameCollector(
            settings.snapshot_max_frames,
            refresh_interval=settings.frame_refresh_interval_snapshots,
        )
        self.memory = StackMemoryCollector(settings)
        self.disassembly = DisassemblyCollector(settings)
        self.variables = VariableCollector(settings)

    async def collect(
        self,
        controller: MIController,
        *,
        session_id: str,
        snapshot_id: int,
        stop_reason: str | None,
        previous: Snapshot | None,
        mode: str = "fast",
        action: str | None = None,
        force_variables: bool = False,
    ) -> Snapshot:
        warnings: list[str] = []
        mode = "full" if mode == "full" else "fast"
        perf = PerfRecorder(snapshot_id=snapshot_id, mode=mode)  # type: ignore[arg-type]
        perf.begin(controller.perf)

        # ---------------------------------------------------------- registers
        registers: dict[str, str | None] = {}
        with perf.measure("registers", controller.perf):
            try:
                registers, register_warnings = await self.registers.collect(controller)
                warnings.extend(register_warnings)
            except Exception as exc:  # never let one section kill the snapshot
                warnings.append(
                    f"Register collection failed: {type(exc).__name__}: {exc}"
                )

        rip = parse_hex_int(registers.get("rip"))
        rsp = parse_hex_int(registers.get("rsp"))
        rbp = parse_hex_int(registers.get("rbp"))

        # ------------------------------------------------------------- frames
        frames: list[FrameModel] = []
        previous_instruction_mnemonic = previous_mnemonic(previous)
        frame_result = None
        with perf.measure("frames", controller.perf):
            try:
                frame_result = await self.frames.collect(
                    controller,
                    snapshot_id=snapshot_id,
                    action=action,
                    previous_mnemonic=previous_instruction_mnemonic,
                    stop_reason=stop_reason,
                    force=mode == "full",
                )
                frames = frame_result.frames
                warnings.extend(frame_result.warnings)
            except Exception as exc:
                warnings.append(
                    f"Frame collection failed: {type(exc).__name__}: {exc}"
                )

        # -------------------------------------------------------- disassembly
        instruction: InstructionModel | None = None
        disassembly: list[DisassemblyItem] = []
        with perf.measure("disassembly", controller.perf):
            try:
                instruction, disassembly, disasm_warnings = (
                    await self.disassembly.collect(
                        controller,
                        rip,
                        snapshot_id=snapshot_id,
                        force_refresh=mode == "full",
                    )
                )
                warnings.extend(disasm_warnings)
            except Exception as exc:
                warnings.append(
                    f"Disassembly failed: {type(exc).__name__}: {exc}"
                )

        # ------------------------------------------------------------- memory
        stack: StackWindow | None = None
        with perf.measure("memory", controller.perf):
            try:
                stack, memory_warnings = await self.memory.collect(
                    controller, rsp=rsp, rbp=rbp, rip=rip
                )
                warnings.extend(memory_warnings)
            except Exception as exc:
                warnings.append(f"Stack memory failed: {type(exc).__name__}: {exc}")

        if stack is None:
            stack = StackWindow()

        read_stats = self.memory.last_read_stats
        if read_stats.degraded:
            warnings.append(
                "Stack memory batch read degraded to chunked reads"
                + (
                    f" ({read_stats.degraded_reason})"
                    if read_stats.degraded_reason
                    else ""
                )
                + "."
            )

        # ---------------------------------------------------------- variables
        variables: list[VariableNode] = []
        variables_available = False
        variables_state = "deferred"
        variables_stale = True
        variables_version: int | None = None
        frame_changed = bool(
            frame_result and frame_result.refreshed and frame_result.changed
        )
        frame_key = frame_result.key if frame_result else None
        with perf.measure("variables", controller.perf):
            try:
                variable_result = await self.variables.collect(
                    controller,
                    mode=mode,
                    # Debug info is a property of the *current* frame; a libc
                    # caller frame with source paths must not make a stripped
                    # current function look like it has DWARF locals.
                    has_debug_file=bool(frames and frames[0].file),
                    frame_key=frame_key,
                    frame_changed=frame_changed,
                    snapshot_id=snapshot_id,
                    # A frame change is positive evidence that the cached
                    # variable objects describe another frame, so rebuilding
                    # them is the only truthful option even in fast mode.
                    # Ordinary steps never pay this cost.
                    force=force_variables or frame_changed,
                )
                variables = variable_result.nodes
                variables_available = variable_result.available
                variables_state = variable_result.state
                variables_stale = variable_result.stale
                variables_version = variable_result.version
                warnings.extend(variable_result.warnings)
            except Exception as exc:
                warnings.append(
                    f"Variable collection failed: {type(exc).__name__}: {exc}"
                )
                variables_state = "unavailable"

        # --------------------------------------------------------------- diff
        with perf.measure("diff", controller.perf):
            try:
                diff = MemoryDiffEngine.compute(previous, registers, stack)
                MemoryDiffEngine.apply_highlights(diff, stack)
            except Exception as exc:
                diff = SnapshotDiff()
                warnings.append(
                    f"Diff calculation failed: {type(exc).__name__}: {exc}"
                )

        stats = perf.finish(controller.perf)
        stats.disassembly_source = self.disassembly.last_source  # type: ignore[assignment]
        stats.disassembly_version = self.disassembly.last_version
        stats.frames_state = (  # type: ignore[assignment]
            frame_result.state if frame_result else "unavailable"
        )
        stats.frames_refreshed = bool(frame_result and frame_result.refreshed)
        stats.variables_state = variables_state  # type: ignore[assignment]
        stats.memory_batch_reads = read_stats.batch_reads
        stats.memory_chunk_reads = read_stats.chunk_reads
        stats.memory_degraded = read_stats.degraded

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
            variables=variables,
            variables_available=variables_available,
            warnings=unique_warnings,
            mode=mode,  # type: ignore[arg-type]
            frames_state=stats.frames_state,
            frames_stale=not stats.frames_refreshed,
            frames_version=frame_result.version if frame_result else None,
            variables_state=variables_state,  # type: ignore[arg-type]
            variables_stale=variables_stale,
            variables_version=variables_version,
            perf=stats,
        )

    async def close(self, controller: MIController) -> None:
        """Delete cached GDB variable objects before the controller closes."""
        await self.variables.close(controller)
