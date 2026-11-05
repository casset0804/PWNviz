"""RSP-centred stack window collection with explicit unreadable bytes.

V1.1 reads the whole window with a single ``-data-read-memory-bytes`` request
when it fits in ``memory_batch_max_bytes`` (default 0x400, i.e. four times the
default 0x200 window). Only when that request fails — or when the window is
larger than the batch limit — does the collector fall back to bounded chunk
reads. Byte-to-address mapping is preserved exactly: a byte that GDB did not
return stays ``None`` and is reported as an unreadable range, never as zero.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.collector.common import (
    align_down,
    align_up,
    hex64,
    parse_hex_int,
    printable_ascii,
)
from app.core.config import Settings
from app.debugger.mi_controller import MIController, MIError
from app.schemas.snapshot import StackRow, StackWindow, UnreadableRange

MAX_WINDOW_BYTES = 0x10000


def compute_window(
    rsp: int, below: int, above: int, max_bytes: int
) -> tuple[int, int]:
    """Return an 8-byte aligned, size-capped window around RSP."""
    below = max(0, below)
    above = max(0, above)
    max_bytes = max(8, max_bytes)
    start = align_down(max(0, rsp - below))
    end = align_up(rsp + above)
    if end <= start:
        end = start + 8
    if end - start > max_bytes:
        end = align_down(start + max_bytes)
        if end <= rsp:
            end = align_up(rsp + 1)
    return start, max(start + 8, end)


@dataclass
class MemoryReadStats:
    """Observable facts about how the window was actually read."""

    requested_bytes: int = 0
    batch_reads: int = 0
    chunk_reads: int = 0
    degraded: bool = False
    degraded_reason: str | None = None
    bytes_read: int = 0

    def as_dict(self) -> dict[str, object]:
        return {
            "requested_bytes": self.requested_bytes,
            "batch_reads": self.batch_reads,
            "chunk_reads": self.chunk_reads,
            "degraded": self.degraded,
            "degraded_reason": self.degraded_reason,
            "bytes_read": self.bytes_read,
        }


class StackMemoryCollector:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # Filled by the most recent collect(); read by SnapshotCollector for perf.
        self.last_read_stats = MemoryReadStats()

    async def collect(
        self,
        controller: MIController,
        *,
        rsp: int | None,
        rbp: int | None,
        rip: int | None,
    ) -> tuple[StackWindow, list[str]]:
        stats = MemoryReadStats()
        self.last_read_stats = stats
        warnings: list[str] = []
        if rsp is None or rsp <= 0:
            return StackWindow(), ["RSP is unavailable; stack memory was not read."]

        below = max(0, self.settings.stack_window_below)
        above = max(0, self.settings.stack_window_above)
        max_bytes = max(
            8, min(self.settings.max_stack_read_bytes, MAX_WINDOW_BYTES)
        )
        start, end = compute_window(rsp, below, above, max_bytes)
        stats.requested_bytes = end - start
        chunk_size = max(8, min(self.settings.memory_chunk_size, 0x400))
        batch_size = max(
            chunk_size,
            min(self.settings.memory_batch_max_bytes, MAX_WINDOW_BYTES),
        )

        bytes_by_address: dict[int, str] = {}
        await self._read_range(
            controller,
            start,
            end,
            batch_size=batch_size,
            chunk_size=chunk_size,
            into=bytes_by_address,
            stats=stats,
            warnings=warnings,
        )

        rows: list[StackRow] = []
        for address in range(start, end, 8):
            cells = [bytes_by_address.get(address + offset) for offset in range(8)]
            readable = all(cell is not None for cell in cells)
            qword = None
            ascii_text = None
            if readable:
                raw = bytes(int(cell, 16) for cell in cells if cell is not None)
                qword = f"0x{int.from_bytes(raw, 'little'):016x}"
                ascii_text = printable_ascii(raw)
            annotations: list[str] = []
            if address <= rsp < address + 8:
                annotations.append("RSP")
            if rbp is not None and address <= rbp < address + 8:
                annotations.append("RBP")
            if rip is not None and address <= rip < address + 8:
                annotations.append("RIP")
            rows.append(
                StackRow(
                    address=hex64(address),
                    bytes=cells,
                    readable=readable,
                    qword_le=qword,
                    ascii=ascii_text,
                    annotations=annotations,
                )
            )

        missing_addresses = [
            address for address in range(start, end) if address not in bytes_by_address
        ]
        stats.bytes_read = len(bytes_by_address)
        missing_bytes = len(missing_addresses)
        if missing_bytes > 0:
            warnings.append(
                f"{missing_bytes} byte(s) in the stack window were unreadable."
            )
        return (
            StackWindow(
                range_start=hex64(start),
                range_end=hex64(end),
                word_size=8,
                rows=rows,
                unreadable_ranges=[
                    UnreadableRange(start=hex64(low), end=hex64(high))
                    for low, high in _ranges_from_addresses(missing_addresses)
                ],
            ),
            warnings,
        )

    # --------------------------------------------------------------- internals
    async def _read_range(
        self,
        controller: MIController,
        start: int,
        end: int,
        *,
        batch_size: int,
        chunk_size: int,
        into: dict[int, str],
        stats: MemoryReadStats,
        warnings: list[str],
    ) -> None:
        """Fill ``into`` for [start, end), batching and degrading as needed."""
        cursor = start
        while cursor < end:
            span = min(batch_size, end - cursor)
            goal = end if span < 8 else cursor + span
            await self._try_batch(
                controller,
                cursor,
                goal,
                chunk_size=chunk_size,
                into=into,
                stats=stats,
                warnings=warnings,
            )
            cursor = goal

    async def _try_batch(
        self,
        controller: MIController,
        start: int,
        end: int,
        *,
        chunk_size: int,
        into: dict[int, str],
        stats: MemoryReadStats,
        warnings: list[str],
    ) -> None:
        count = end - start
        if count <= 0:
            return
        stats.batch_reads += 1
        try:
            record = await controller.execute(
                f"-data-read-memory-bytes {hex64(start)} {count}"
            )
        except MIError as exc:
            stats.degraded = True
            stats.degraded_reason = str(exc)
            await self._read_chunks(
                controller,
                start,
                end,
                chunk_size=chunk_size,
                into=into,
                stats=stats,
                warnings=warnings,
            )
            return

        missing = _merge_blocks(record, start, end, into)
        if not missing:
            return
        # The command succeeded but the kernel-level read was partial (for
        # example a window crossing an unmapped page). Salvage the gaps with
        # chunk reads instead of silently presenting them as zero.
        stats.degraded = True
        if stats.degraded_reason is None:
            stats.degraded_reason = "partial batch response"
        for low, high in _ranges_from_addresses(missing):
            await self._read_chunks(
                controller,
                low,
                high,
                chunk_size=chunk_size,
                into=into,
                stats=stats,
                warnings=warnings,
            )

    async def _read_chunks(
        self,
        controller: MIController,
        start: int,
        end: int,
        *,
        chunk_size: int,
        into: dict[int, str],
        stats: MemoryReadStats,
        warnings: list[str],
    ) -> None:
        for chunk_start in range(start, end, chunk_size):
            chunk_end = min(chunk_start + chunk_size, end)
            stats.chunk_reads += 1
            try:
                record = await controller.execute(
                    f"-data-read-memory-bytes {hex64(chunk_start)} "
                    f"{chunk_end - chunk_start}"
                )
            except MIError as exc:
                if len(warnings) < 3:
                    warnings.append(
                        f"Unreadable stack range at {hex64(chunk_start)}: {exc}"
                    )
                continue
            _merge_blocks(record, chunk_start, chunk_end, into)


def _merge_blocks(
    record: dict, start: int, end: int, into: dict[int, str]
) -> list[int]:
    """Copy returned blocks into ``into`` and return still-missing addresses."""
    payload = record.get("payload") or {}
    for block in payload.get("memory") or []:
        try:
            begin = int(str(block.get("begin")), 16)
            raw = bytes.fromhex(str(block.get("contents") or ""))
        except (TypeError, ValueError):
            continue
        for index, byte in enumerate(raw):
            address = begin + index
            if start <= address < end:
                into[address] = f"{byte:02x}"
    return [address for address in range(start, end) if address not in into]


def _ranges_from_addresses(addresses: list[int]) -> list[tuple[int, int]]:
    """Group sorted missing byte addresses into [start, end) ranges."""
    if not addresses:
        return []
    ranges: list[tuple[int, int]] = []
    low = previous = addresses[0]
    for address in addresses[1:]:
        if address == previous + 1:
            previous = address
            continue
        ranges.append((low, previous + 1))
        low = previous = address
    ranges.append((low, previous + 1))
    return ranges


__all__ = [
    "MemoryReadStats",
    "StackMemoryCollector",
    "compute_window",
    "parse_hex_int",
]
