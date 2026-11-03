"""Register collection over GDB/MI."""

from __future__ import annotations

from app.collector.common import normalize_hex
from app.debugger.mi_controller import MIController, MIError

REQUIRED_REGISTERS = (
    "rip",
    "rsp",
    "rbp",
    "rax",
    "rbx",
    "rcx",
    "rdx",
    "rsi",
    "rdi",
    "r8",
    "r9",
    "r10",
    "r11",
    "r12",
    "r13",
    "r14",
    "r15",
    "eflags",
)

NAME_ALIASES = {
    "eflags": ("eflags", "rflags"),
}


class RegisterCollector:
    def __init__(self) -> None:
        self._name_index: dict[str, int] | None = None

    async def collect(
        self, controller: MIController
    ) -> tuple[dict[str, str | None], list[str]]:
        warnings: list[str] = []
        names = await self._names(controller, warnings)
        if not names:
            return await self._evaluate_all(controller, warnings)

        indexes: list[int] = []
        canonical_for_index: dict[int, str] = {}
        for canonical in REQUIRED_REGISTERS:
            lookup = NAME_ALIASES.get(canonical, (canonical,))
            index = next((names[name] for name in lookup if name in names), None)
            if index is None:
                continue
            indexes.append(index)
            canonical_for_index[index] = canonical

        if not indexes:
            warnings.append("GDB reported no usable register names.")
            return await self._evaluate_all(controller, warnings)

        result: dict[str, str | None] = {name: None for name in REQUIRED_REGISTERS}
        try:
            record = await controller.execute(
                "-data-list-register-values x "
                + " ".join(str(index) for index in indexes)
            )
            payload = record.get("payload") or {}
            for entry in payload.get("register-values") or []:
                try:
                    index = int(str(entry.get("number")))
                except (TypeError, ValueError):
                    continue
                canonical = canonical_for_index.get(index)
                if canonical is not None:
                    result[canonical] = normalize_hex(entry.get("value"))
        except MIError as exc:
            warnings.append(f"Register value read failed: {exc}")
            return await self._evaluate_all(controller, warnings)

        missing = [name for name, value in result.items() if value is None]
        if missing:
            evaluated, extra_warnings = await self._evaluate_all(
                controller, [], only=missing
            )
            result.update({name: evaluated.get(name) for name in missing})
            warnings.extend(extra_warnings)
        return result, warnings

    async def _names(
        self, controller: MIController, warnings: list[str]
    ) -> dict[str, int] | None:
        if self._name_index is not None:
            return self._name_index
        try:
            record = await controller.execute("-data-list-register-names")
            payload = record.get("payload") or {}
            raw_names = payload.get("register-names") or []
        except MIError as exc:
            warnings.append(f"Register name query failed: {exc}")
            return None

        index: dict[str, int] = {}
        for position, name in enumerate(raw_names):
            if isinstance(name, str) and name:
                index.setdefault(name.lower(), position)
        self._name_index = index or None
        return self._name_index

    async def _evaluate_all(
        self,
        controller: MIController,
        warnings: list[str],
        *,
        only: list[str] | None = None,
    ) -> tuple[dict[str, str | None], list[str]]:
        result: dict[str, str | None] = {}
        targets = only if only is not None else list(REQUIRED_REGISTERS)
        for name in targets:
            try:
                record = await controller.execute(
                    f"-data-evaluate-expression ${name}"
                )
                payload = record.get("payload") or {}
                value = payload.get("value")
                token = str(value).split()[0] if isinstance(value, str) else None
                result[name] = normalize_hex(token)
            except MIError:
                result[name] = None
        if any(value is None for value in result.values()):
            warnings.append("Some registers could not be read from GDB.")
        return result, warnings
