"""DWARF-backed variable semantics via GDB/MI variable objects.

This module deliberately does not import pwndbg or any private debugger module.
Every node starts from GDB's own ``-stack-list-variables``/``-var-create`` data;
the only extra reads are explicitly bounded pointer-target reads. Raw memory and
register collection are independent and still succeed if this module fails.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.collector.common import hex64, normalize_hex, parse_hex_int
from app.core.config import Settings
from app.debugger.mi_controller import MIController, MIError
from app.schemas.snapshot import VariableNode

MAX_VARIABLES = 64
MAX_CHILDREN = 128
MAX_DEPTH = 3
MAX_POINTER_READS = 16
POINTER_READ_BYTES = 64

_CHAR_ARRAY_RE = re.compile(r"^(?:const\s+)?char\s*\[", re.IGNORECASE)
_CHAR_POINTER_RE = re.compile(r"^(?:const\s+)?char\s*\*(?!\s*\*)", re.IGNORECASE)
_QUOTED_RE = re.compile(r'"((?:\\.|[^"\\])*)"')


def _mi_quote(text: str) -> str:
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in text):
        # MI is line-oriented. A DWARF name or path expression containing a
        # newline must never become a second GDB command.
        raise ValueError("MI argument contains control characters")
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _first_hex(text: object) -> str | None:
    if not isinstance(text, str):
        return None
    token = text.strip().split(None, 1)[0] if text.strip() else ""
    return normalize_hex(token)


def _kind_for(type_name: str) -> str:
    lower = type_name.lower().strip()
    if "*" in lower:
        return "pointer"
    if _CHAR_ARRAY_RE.match(lower):
        return "string"
    if lower.startswith(("struct ", "union ")) or "struct " in lower:
        return "struct" if lower.startswith("struct ") else "union"
    if "[" in lower:
        return "array"
    return "scalar"


def _quoted_string(value: str | None) -> str | None:
    if not value:
        return None
    match = _QUOTED_RE.search(value)
    if not match:
        return None
    raw = match.group(1)
    try:
        # GDB escapes C-like characters; decode enough for teaching display.
        return bytes(raw, "utf-8").decode("unicode_escape")
    except (UnicodeDecodeError, ValueError):
        return raw


@dataclass
class _Budget:
    nodes: int = 0
    children: int = 0
    pointer_reads: int = 0
    memory_bytes: int = 0
    warnings: list[str] = field(default_factory=list)

    def take_node(self) -> bool:
        if self.nodes >= MAX_VARIABLES + MAX_CHILDREN:
            return False
        self.nodes += 1
        return True

    def take_child(self) -> bool:
        if self.children >= MAX_CHILDREN:
            return False
        self.children += 1
        return self.take_node()


class VariableCollector:
    """Collect current-frame locals/arguments without touching raw memory paths."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def collect(
        self, controller: MIController, *, has_debug_file: bool
    ) -> tuple[list[VariableNode], bool, list[str]]:
        warnings: list[str] = []
        try:
            record = await controller.execute(
                "-stack-list-variables --all-values"
            )
        except MIError as exc:
            warnings.append(f"DWARF variable query failed: {exc}")
            return [], False, warnings

        payload = record.get("payload") or {}
        raw_variables = payload.get("variables") or []
        if not isinstance(raw_variables, list):
            raw_variables = []
        if not raw_variables and not has_debug_file:
            warnings.append(
                "No DWARF variable information is available; raw stack and registers remain usable."
            )
            return [], False, warnings

        roots: list[VariableNode] = []
        created: list[str] = []
        budget = _Budget()
        try:
            for raw in raw_variables[:MAX_VARIABLES]:
                if not isinstance(raw, dict):
                    continue
                name = raw.get("name")
                if not isinstance(name, str) or not name:
                    continue
                try:
                    created_record = await controller.execute(
                        f"-var-create - * {_mi_quote(name)}"
                    )
                except (MIError, ValueError) as exc:
                    warnings.append(f"Variable {name!r} could not be created: {exc}")
                    continue
                created_payload = created_record.get("payload") or {}
                var_name = created_payload.get("name")
                type_name = created_payload.get("type")
                if isinstance(var_name, str):
                    # Register cleanup before validating the type, otherwise a
                    # malformed result can leave a GDB variable object behind.
                    created.append(var_name)
                if not isinstance(var_name, str) or not isinstance(type_name, str):
                    continue
                if not budget.take_node():
                    break
                node = await self._build_node(
                    controller,
                    var_name=var_name,
                    display_name=name,
                    type_name=type_name,
                    raw_value=created_payload.get("value"),
                    is_argument=str(raw.get("arg", "0")) == "1",
                    frame_level=0,
                    depth=0,
                    budget=budget,
                )
                roots.append(node)
        finally:
            for var_name in created:
                try:
                    await controller.execute(f"-var-delete {var_name}")
                except MIError:
                    pass

        if len(raw_variables) > MAX_VARIABLES:
            warnings.append(
                f"Only the first {MAX_VARIABLES} variables were inspected."
            )
        if budget.warnings:
            warnings.extend(budget.warnings)
        return roots, True, warnings

    async def _build_node(
        self,
        controller: MIController,
        *,
        var_name: str,
        display_name: str,
        type_name: str,
        raw_value: object,
        is_argument: bool,
        frame_level: int,
        depth: int,
        budget: _Budget,
    ) -> VariableNode:
        value = str(raw_value) if raw_value is not None else None
        optimized = value is not None and "<optimized out>" in value
        synthetic = value is not None and "<synthetic" in value.lower()
        kind = _kind_for(type_name)
        path: str | None = None
        try:
            path_record = await controller.execute(
                f"-var-info-path-expression {var_name}"
            )
            candidate = (path_record.get("payload") or {}).get("path_expr")
            if (
                isinstance(candidate, str)
                and candidate
                and not any(
                    ord(character) < 0x20 or ord(character) == 0x7F
                    for character in candidate
                )
            ):
                path = candidate
        except MIError:
            path = None

        address: str | None = None
        address_error: str | None = None
        if path and not optimized:
            try:
                address_record = await controller.execute(
                    f"-data-evaluate-expression {_mi_quote(f'&({path})')}"
                )
                address = _first_hex(
                    (address_record.get("payload") or {}).get("value")
                )
            except (MIError, ValueError) as exc:
                address_error = str(exc)

        if optimized:
            location_kind = "optimized_out"
        elif synthetic:
            location_kind = "unavailable"
        elif address:
            location_kind = "memory"
        elif address_error and "register" in address_error.lower():
            location_kind = "register"
        elif address_error and "cannot take address" in address_error.lower():
            location_kind = "register"
        elif address_error and "optimized" in address_error.lower():
            location_kind = "optimized_out"
        elif value is None or value in {"<unavailable>", "<error>"}:
            location_kind = "unavailable"
        elif address_error:
            location_kind = "unknown"
        else:
            location_kind = "unknown"

        node = VariableNode(
            name=display_name,
            type=type_name,
            value=None if optimized or synthetic else value,
            address=address,
            location_kind=location_kind,
            source="dwarf",
            confidence="debug-info",
            kind=kind,
            is_argument=is_argument,
            frame_level=frame_level,
        )

        if kind == "string":
            node.string_value = _quoted_string(value) or self._string_from_children(
                await self._children(controller, var_name)
            )
            return node

        if kind == "pointer":
            node.pointer_target = _first_hex(value)
            if synthetic:
                node.target_readable = False
                node.target_source = "dwarf"
            else:
                await self._read_pointer_target(
                    controller,
                    node,
                    budget,
                    as_string=bool(_CHAR_POINTER_RE.match(type_name)),
                )
            return node

        if kind in {"array", "struct", "union"} and depth < MAX_DEPTH:
            children = await self._children(controller, var_name)
            for child in children:
                if not budget.take_child():
                    budget.warnings.append(
                        "Variable tree was truncated by the node/child limit."
                    )
                    break
                child_name = child.get("name")
                child_type = child.get("type")
                child_exp = child.get("exp")
                if not isinstance(child_name, str) or not isinstance(child_type, str):
                    continue
                child_display = (
                    child_exp if isinstance(child_exp, str) and child_exp else child_name
                )
                node.children.append(
                    await self._build_node(
                        controller,
                        var_name=child_name,
                        display_name=child_display,
                        type_name=child_type,
                        raw_value=child.get("value"),
                        is_argument=False,
                        frame_level=frame_level,
                        depth=depth + 1,
                        budget=budget,
                    )
                )
        return node

    async def _children(self, controller: MIController, var_name: str) -> list[dict]:
        try:
            record = await controller.execute(
                f"-var-list-children --all-values {var_name}"
            )
        except MIError:
            return []
        payload = record.get("payload") or {}
        children = payload.get("children") or []
        if not isinstance(children, list):
            return []
        return [child for child in children if isinstance(child, dict)]

    @staticmethod
    def _string_from_children(children: list[dict]) -> str | None:
        chars: list[str] = []
        for child in children:
            value = child.get("value")
            if not isinstance(value, str):
                continue
            match = re.match(r"\s*(\d+)", value)
            if match:
                code = int(match.group(1))
                if code == 0:
                    break
                if 0x20 <= code <= 0x7E:
                    chars.append(chr(code))
        return "".join(chars) or None

    async def _read_pointer_target(
        self,
        controller: MIController,
        node: VariableNode,
        budget: _Budget,
        *,
        as_string: bool,
    ) -> None:
        target = parse_hex_int(node.pointer_target)
        if target is None:
            node.target_readable = False
            node.target_source = "gdb-memory"
            return
        if target == 0:
            node.target_readable = False
            node.target_source = "gdb-memory"
            return
        if (
            budget.pointer_reads >= MAX_POINTER_READS
            or budget.memory_bytes >= MAX_POINTER_READS * POINTER_READ_BYTES
        ):
            node.target_readable = None
            node.target_source = "not-read"
            return
        budget.pointer_reads += 1
        try:
            record = await controller.execute(
                f"-data-read-memory-bytes {hex64(target)} {POINTER_READ_BYTES}"
            )
        except MIError:
            node.target_readable = False
            node.target_source = "gdb-memory"
            return
        data = bytearray()
        for block in (record.get("payload") or {}).get("memory") or []:
            try:
                begin = int(str(block.get("begin")), 16)
                contents = bytes.fromhex(str(block.get("contents") or ""))
            except (TypeError, ValueError):
                continue
            if begin == target:
                data.extend(contents)
        if not data:
            node.target_readable = False
            node.target_source = "gdb-memory"
            return
        budget.memory_bytes += len(data)
        node.target_bytes = bytes(data).hex()
        node.target_readable = True
        node.target_source = "gdb-memory"
        if as_string:
            terminated = bytes(data).split(b"\x00", 1)[0]
            node.target_string = (
                terminated.decode("utf-8", errors="replace") if terminated else None
            )
