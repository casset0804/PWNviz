"""RIP-centred disassembly collection with a versioned window cache.

A fast snapshot must not re-ask GDB for the same instructions. The collector
keeps the last disassembled window, its instruction text *and* the instruction
bytes for that window (read once with a single MI command), together with the
snapshot id it was fetched in.

Rules enforced here:

* instructions are only served from the cache while RIP is inside the cached
  window **and** on a known instruction boundary;
* anything outside the cache is fetched from GDB again — a cached instruction is
  never extrapolated to an address it was not observed at;
* ``bytes`` for each instruction are sliced from the real memory dump of the
  window, so ``RIP advance == instruction length`` remains a real check;
* the model carries the snapshot version of the window it came from.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.collector.common import hex64, parse_hex_int
from app.core.config import Settings
from app.debugger.mi_controller import MIController, MIError
from app.schemas.snapshot import DisassemblyItem, InstructionModel

MAX_INSTRUCTION_BYTES = 15


@dataclass
class _CachedInstruction:
    address: int
    text: str
    function: str | None
    bytes_hex: str | None


@dataclass
class _Window:
    start: int
    end: int
    version: int
    instructions: dict[int, _CachedInstruction] = field(default_factory=dict)
    blocks: dict[int, bytes] = field(default_factory=dict)

    def covers(self, rip: int) -> bool:
        return self.start <= rip < self.end and rip in self.instructions

    def ordered(self) -> list[_CachedInstruction]:
        return [self.instructions[address] for address in sorted(self.instructions)]


class DisassemblyCollector:
    """Collect the RIP window, reusing it until RIP leaves the observed range."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._window: _Window | None = None
        # Observable facts for SnapshotPerf.
        self.last_source: str = "none"
        self.last_version: int | None = None

    def invalidate(self) -> None:
        self._window = None

    async def collect(
        self,
        controller: MIController,
        rip: int | None,
        *,
        snapshot_id: int = 0,
        force_refresh: bool = False,
    ) -> tuple[InstructionModel | None, list[DisassemblyItem], list[str]]:
        if rip is None:
            self.last_source = "none"
            self.last_version = None
            return None, [], ["RIP is unavailable; disassembly was not read."]

        window = self._window
        if (
            force_refresh
            or window is None
            or not window.covers(rip)
        ):
            fetched = await self._fetch(controller, rip, snapshot_id)
            if fetched is None:
                self.last_source = "none"
                self.last_version = None
                return None, [], [
                    "Disassembly could not be read from GDB; no cached window is "
                    "being substituted."
                ]
            warnings = fetched[0]
            self._window = fetched[1]
            window = self._window
            self.last_source = "gdb"
            self.last_version = window.version if window else None
            if window is None:
                return None, [], warnings
            instruction = self._instruction_at(window, rip)
            if instruction is None:
                return None, self._items(window, rip), warnings + [
                    "RIP was not present in the disassembly window."
                ]
            return instruction, self._items(window, rip), warnings

        self.last_source = "cache"
        self.last_version = window.version
        instruction = self._instruction_at(window, rip)
        if instruction is None:  # pragma: no cover - covers() already checked
            return None, self._items(window, rip), [
                "RIP was not present in the cached disassembly window."
            ]
        return instruction, self._items(window, rip), []

    # ------------------------------------------------------------------ fetch
    async def _fetch(
        self, controller: MIController, rip: int, snapshot_id: int
    ) -> tuple[list[str], _Window] | None:
        before = max(0, min(self.settings.disassembly_before, 0x1000))
        after = max(0, min(self.settings.disassembly_after, 0x1000))
        start = max(0, rip - before)
        end = rip + after
        if end <= start:
            end = start + 16

        try:
            record = await controller.execute(
                f"-data-disassemble -s {hex64(start)} -e {hex64(end)} -- 1"
            )
        except MIError as exc:
            return None

        payload = record.get("payload") or {}
        entries: list[dict[str, Any]] = []
        for group in payload.get("asm_insns") or []:
            if not isinstance(group, dict):
                continue
            instructions = group.get("line_asm_insn")
            if isinstance(instructions, list):
                entries.extend(
                    item for item in instructions if isinstance(item, dict)
                )
            elif "address" in group and "inst" in group:
                entries.append(group)

        parsed: list[tuple[int, dict[str, Any]]] = []
        for entry in entries:
            address = parse_hex_int(str(entry.get("address") or ""))
            text = entry.get("inst")
            if address is None or not isinstance(text, str):
                continue
            parsed.append((address, entry))
        parsed.sort(key=lambda item: item[0])
        if not parsed:
            return None

        window = _Window(
            start=min(address for address, _entry in parsed),
            end=max(address for address, _entry in parsed) + MAX_INSTRUCTION_BYTES,
            version=snapshot_id,
        )
        lengths = self._lengths(parsed)
        window.blocks = (
            await self._window_bytes(
                controller, window.start, max(window.end - window.start, 0)
            )
            or {}
        )
        for index, (address, entry) in enumerate(parsed):
            length = lengths[index]
            text = str(entry.get("inst") or "").strip()
            bytes_hex = None
            if length:
                chunk = _slice_bytes(window.blocks, address, length)
                if chunk is not None:
                    bytes_hex = chunk.hex()
            window.instructions[address] = _CachedInstruction(
                address=address,
                text=text,
                function=entry.get("func-name") or None,
                bytes_hex=bytes_hex,
            )
        if not window.instructions:
            return None
        rip_entry = window.instructions.get(rip)
        if rip_entry is not None and rip_entry.bytes_hex is None:
            # RIP happened to be the last instruction in the window, so its
            # length was unknown. Ask GDB once for the next boundary instead of
            # inventing an instruction length.
            length = await self._probe_length(controller, rip)
            if length:
                chunk = _slice_bytes(window.blocks, rip, length)
                if chunk is not None:
                    window.instructions[rip] = _CachedInstruction(
                        address=rip_entry.address,
                        text=rip_entry.text,
                        function=rip_entry.function,
                        bytes_hex=chunk.hex(),
                    )
        return [], window

    @staticmethod
    def _lengths(parsed: list[tuple[int, dict[str, Any]]]) -> list[int | None]:
        lengths: list[int | None] = []
        for index, (address, _entry) in enumerate(parsed):
            next_address = (
                parsed[index + 1][0] if index + 1 < len(parsed) else None
            )
            if next_address is None:
                lengths.append(None)
                continue
            length = next_address - address
            lengths.append(length if 1 <= length <= MAX_INSTRUCTION_BYTES else None)
        return lengths

    async def _window_bytes(
        self, controller: MIController, start: int, count: int
    ) -> dict[int, bytes] | None:
        """One bounded read of the whole window so every instruction has bytes."""
        if count <= 0:
            return None
        span = min(count, 0x400)
        try:
            record = await controller.execute(
                f"-data-read-memory-bytes {hex64(start)} {span}"
            )
        except MIError:
            return None
        payload = record.get("payload") or {}
        result: dict[int, bytes] = {}
        for block in payload.get("memory") or []:
            try:
                begin = int(str(block.get("begin")), 16)
                data = bytes.fromhex(str(block.get("contents") or ""))
            except (TypeError, ValueError):
                continue
            result[begin] = data
        return result or None

    async def _probe_length(
        self, controller: MIController, rip: int
    ) -> int | None:
        """Discover the length of the instruction at ``rip`` from GDB alone."""
        try:
            record = await controller.execute(
                f"-data-disassemble -s {hex64(rip)} -e {hex64(rip + 16)} -- 1"
            )
        except MIError:
            return None
        addresses: list[int] = []
        for group in (record.get("payload") or {}).get("asm_insns") or []:
            if not isinstance(group, dict):
                continue
            for entry in group.get("line_asm_insn") or []:
                if isinstance(entry, dict):
                    address = parse_hex_int(str(entry.get("address") or ""))
                    if address is not None:
                        addresses.append(address)
        addresses = sorted(address for address in addresses if address >= rip)
        if len(addresses) < 2 or addresses[0] != rip:
            return None
        length = addresses[1] - rip
        return length if 1 <= length <= MAX_INSTRUCTION_BYTES else None

    # ------------------------------------------------------------------ views
    @staticmethod
    def _instruction_at(window: _Window, rip: int) -> InstructionModel | None:
        cached = window.instructions.get(rip)
        if cached is None:
            return None
        parts = cached.text.split(None, 1)
        return InstructionModel(
            address=hex64(rip),
            bytes=cached.bytes_hex,
            mnemonic=parts[0] if parts else None,
            operands=parts[1] if len(parts) > 1 else None,
            text=cached.text,
            function=cached.function,
        )

    @staticmethod
    def _items(window: _Window, rip: int) -> list[DisassemblyItem]:
        return [
            DisassemblyItem(
                address=hex64(cached.address),
                text=cached.text,
                is_current=cached.address == rip,
                function=cached.function,
            )
            for cached in window.ordered()
        ]


def _slice_bytes(blocks: dict[int, bytes], address: int, length: int) -> bytes | None:
    """Return exactly ``length`` bytes at ``address`` from GDB's memory blocks."""
    for begin, data in blocks.items():
        end = begin + len(data)
        if begin <= address and address + length <= end:
            offset = address - begin
            return data[offset : offset + length]
    return None


__all__ = ["DisassemblyCollector"]
