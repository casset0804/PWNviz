"""RSP-centred stack window collection with explicit unreadable bytes."""

from __future__ import annotations

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


class StackMemoryCollector:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def collect(
        self,
        controller: MIController,
        *,
        rsp: int | None,
        rbp: int | None,
        rip: int | None,
    ) -> tuple[StackWindow, list[str]]:
        warnings: list[str] = []
        if rsp is None or rsp <= 0:
            return StackWindow(), ["RSP is unavailable; stack memory was not read."]

        below = max(0, self.settings.stack_window_below)
        above = max(0, self.settings.stack_window_above)
        max_bytes = max(8, min(self.settings.max_stack_read_bytes, 0x10000))
        start, end = compute_window(rsp, below, above, max_bytes)
        chunk_size = max(8, min(self.settings.memory_chunk_size, 0x400))

        bytes_by_address: dict[int, str] = {}

        for chunk_start in range(start, end, chunk_size):
            chunk_end = min(chunk_start + chunk_size, end)
            count = chunk_end - chunk_start
            try:
                record = await controller.execute(
                    f"-data-read-memory-bytes {hex64(chunk_start)} {count}"
                )
            except MIError as exc:
                if len(warnings) < 3:
                    warnings.append(
                        f"Unreadable stack range at {hex64(chunk_start)}: {exc}"
                    )
                continue

            payload = record.get("payload") or {}
            blocks = payload.get("memory") or []
            if not blocks:
                continue
            for block in blocks:
                try:
                    begin = int(str(block.get("begin")), 16)
                    raw = bytes.fromhex(str(block.get("contents") or ""))
                except (TypeError, ValueError):
                    continue
                for index, byte in enumerate(raw):
                    address = begin + index
                    if chunk_start <= address < chunk_end:
                        bytes_by_address[address] = f"{byte:02x}"

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


__all__ = ["StackMemoryCollector", "compute_window", "parse_hex_int"]
