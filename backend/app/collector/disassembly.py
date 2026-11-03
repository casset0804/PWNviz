"""RIP-centred disassembly collection."""

from __future__ import annotations

from typing import Any

from app.collector.common import hex64, parse_hex_int
from app.core.config import Settings
from app.debugger.mi_controller import MIController, MIError
from app.schemas.snapshot import DisassemblyItem, InstructionModel


class DisassemblyCollector:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def collect(
        self, controller: MIController, rip: int | None
    ) -> tuple[InstructionModel | None, list[DisassemblyItem], list[str]]:
        if rip is None:
            return None, [], ["RIP is unavailable; disassembly was not read."]

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
            return None, [], [f"Disassembly failed: {exc}"]

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

        items: list[DisassemblyItem] = []
        for address, entry in parsed:
            text = str(entry.get("inst") or "").strip()
            items.append(
                DisassemblyItem(
                    address=hex64(address),
                    text=text,
                    is_current=address == rip,
                    function=entry.get("func-name") or None,
                )
            )

        current = next((entry for address, entry in parsed if address == rip), None)
        if current is None:
            return None, items, ["RIP was not present in the disassembly window."]

        text = str(current.get("inst") or "").strip()
        mnemonic_parts = text.split(None, 1)
        raw_bytes = await self._instruction_bytes(controller, rip, parsed)
        instruction = InstructionModel(
            address=hex64(rip),
            bytes=raw_bytes,
            mnemonic=mnemonic_parts[0] if mnemonic_parts else None,
            operands=mnemonic_parts[1] if len(mnemonic_parts) > 1 else None,
            text=text,
            function=current.get("func-name") or None,
        )
        return instruction, items, []

    async def _instruction_bytes(
        self,
        controller: MIController,
        rip: int,
        parsed: list[tuple[int, dict[str, Any]]],
    ) -> str | None:
        next_address = next(
            (address for address, _ in parsed if address > rip), None
        )
        if next_address is None:
            return None
        length = next_address - rip
        if not 1 <= length <= 15:
            return None
        try:
            record = await controller.execute(
                f"-data-read-memory-bytes {hex64(rip)} 16"
            )
        except MIError:
            return None
        payload = record.get("payload") or {}
        for block in payload.get("memory") or []:
            try:
                if int(str(block.get("begin")), 16) != rip:
                    continue
                data = bytes.fromhex(str(block.get("contents") or ""))
            except (TypeError, ValueError):
                continue
            if len(data) >= length:
                return data[:length].hex()
        return None
