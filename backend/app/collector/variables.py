"""DWARF-backed variable semantics with a persistent GDB variable-object cache.

V1.1 changes *when* work is done, never *what* is measured:

* a **full** collection builds/updates the variable tree from GDB variable
  objects (``-stack-list-variables``, ``-var-create``,
  ``-var-info-path-expression``, ``-data-evaluate-expression``,
  ``-var-list-children``, bounded ``-data-read-memory-bytes``);
* once the tree exists it is kept and refreshed with ``-var-update`` instead of
  being destroyed and rebuilt on every stop;
* a **fast** collection performs **zero** variable commands and returns the
  cached tree with ``variables_stale=True`` plus the snapshot id it was measured
  in, so the UI can label it honestly instead of presenting old values as new;
* variable objects are deleted when the frame changes, when the variable name
  set changes, when a variable object reports ``in_scope=false``/errors, and
  when the cache exceeds its object budget. They are never left to accumulate.

This module still does not import pwndbg or any private debugger module.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

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


def _first_int(text: object) -> int | None:
    """Parse the leading integer GDB prints for ``sizeof`` (decimal or hex)."""
    if not isinstance(text, str):
        return None
    token = text.strip().split(None, 1)[0] if text.strip() else ""
    if not token:
        return None
    try:
        value = int(token, 16) if token.lower().startswith("0x") else int(token, 10)
    except ValueError:
        return None
    return value if value > 0 else None


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


@dataclass
class _VarEntry:
    """One cached variable object and everything measured about it."""

    var_name: str
    name: str
    type: str
    value: str | None
    address: str | None
    size_bytes: int | None
    location_kind: str
    kind: str
    is_argument: bool
    frame_level: int
    depth: int = 0
    children: list["_VarEntry"] = field(default_factory=list)
    string_value: str | None = None
    pointer_target: str | None = None
    target_readable: bool | None = None
    target_bytes: str | None = None
    target_string: str | None = None
    target_source: str | None = None

    def render(self) -> VariableNode:
        return VariableNode(
            name=self.name,
            type=self.type,
            value=None
            if self.location_kind in {"optimized_out", "unavailable"}
            else self.value,
            address=self.address,
            size_bytes=self.size_bytes,
            location_kind=self.location_kind,  # type: ignore[arg-type]
            source="dwarf",
            confidence="debug-info",
            kind=self.kind,
            is_argument=self.is_argument,
            frame_level=self.frame_level,
            children=[child.render() for child in self.children],
            string_value=self.string_value,
            pointer_target=self.pointer_target,
            target_readable=self.target_readable,
            target_bytes=self.target_bytes,
            target_string=self.target_string,
            target_source=self.target_source,
        )


@dataclass
class VariableResult:
    nodes: list[VariableNode]
    available: bool
    state: str
    stale: bool
    version: int | None
    warnings: list[str]


class VariableCache:
    """Owns the GDB variable objects and the measured variable tree."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.max_objects = max(8, min(settings.variable_cache_max_objects, 2048))
        self.entries: list[_VarEntry] = []
        self.names: tuple[str, ...] = ()
        self.frame_key: tuple[Any, ...] | None = None
        self.available = False
        self.version: int | None = None
        self.object_count = 0
        self.pending_build = True

    # -------------------------------------------------------------- lifecycle
    def invalidate(self, *, keep_available: bool = True) -> None:
        self.entries = []
        self.names = ()
        self.frame_key = None
        self.object_count = 0
        self.version = None
        if not keep_available:
            self.available = False
        self.pending_build = True

    def is_empty(self) -> bool:
        return not self.entries

    def over_budget(self) -> bool:
        return self.object_count > self.max_objects


class VariableCollector:
    """Full rebuild, incremental ``-var-update`` refresh, and fast caching."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.cache = VariableCache(settings)

    # ------------------------------------------------------------------ public
    async def collect(
        self,
        controller: MIController,
        *,
        mode: str,
        has_debug_file: bool,
        frame_key: tuple[Any, ...] | None,
        frame_changed: bool = False,
        snapshot_id: int = 0,
        force: bool = False,
    ) -> VariableResult:
        cache = self.cache
        if frame_changed:
            # The frame instance changed: cached objects describe another
            # frame. Delete them from GDB (bounded, once per frame change) and
            # forget the cached values, but remember that debug info exists.
            if cache.entries:
                await self._delete_all(controller)
            cache.invalidate(keep_available=True)
        # ``force`` only means "do not defer in fast mode"; it never implies a
        # destroy-and-rebuild. An explicit refresh therefore still reuses the
        # existing variable objects through -var-update when it can.

        # -------------------------- fast path: never rebuilds the tree.
        # The cached tree is refreshed with one ``-var-update`` so values are
        # current rather than silently stale; the tree structure is reused, so
        # this is not a full variable-tree construction. Zero commands are sent
        # when there is no cached tree (the result is labelled "deferred").
        if mode == "fast" and not force:
            if not cache.entries:
                return VariableResult(
                    nodes=[],
                    available=cache.available,
                    state="deferred",
                    stale=True,
                    version=cache.version,
                    warnings=[],
                )
            updated = await self._refresh(controller, snapshot_id)
            if updated is not None:
                cache.version = snapshot_id
                cache.available = True
                return VariableResult(
                    nodes=[entry.render() for entry in cache.entries],
                    available=True,
                    state="updated",
                    stale=False,
                    version=snapshot_id,
                    warnings=[],
                )
            # The update failed (out-of-scope variable object, GDB error): show
            # the last measured values but mark them as cached, never as current.
            return VariableResult(
                nodes=[entry.render() for entry in cache.entries],
                available=cache.available,
                state="cached",
                stale=True,
                version=cache.version,
                warnings=[
                    "Cached variable objects could not be refreshed with "
                    "-var-update; showing the last measured values as cached."
                ],
            )

        # -------------------------- full path: rebuild or update in place.
        warnings: list[str] = []
        queried = await self._variable_names(controller, warnings)
        if queried is None:
            return VariableResult(
                nodes=[],
                available=False,
                state="unavailable",
                stale=False,
                version=None,
                warnings=warnings,
            )
        names, arguments = queried

        if not names:
            await self._delete_all(controller)
            cache.invalidate(keep_available=False)
            cache.pending_build = False
            if not has_debug_file:
                warnings.append(
                    "No DWARF variable information is available; raw stack and "
                    "registers remain usable."
                )
            else:
                warnings.append(
                    "GDB reported no local variables in the current frame."
                )
            return VariableResult(
                nodes=[],
                available=False,
                state="unavailable",
                stale=False,
                version=snapshot_id,
                warnings=warnings,
            )

        if (
            cache.entries
            and cache.pending_build is False
            and cache.frame_key == frame_key
            and cache.names == names
        ):
            updated = await self._refresh(controller, snapshot_id)
            if updated is not None:
                cache.version = snapshot_id
                cache.available = True
                return VariableResult(
                    nodes=[entry.render() for entry in cache.entries],
                    available=True,
                    state="full",
                    stale=False,
                    version=snapshot_id,
                    warnings=warnings,
                )
            warnings.append(
                "Cached variable objects could not be refreshed with "
                "-var-update; the tree was rebuilt from GDB."
            )

        # Rebuild from scratch: the frame, the name set or GDB's varobj list
        # changed, so stale objects must not be reused.
        await self._delete_all(controller)
        cache.invalidate(keep_available=False)
        built = await self._build(controller, names, arguments, warnings)
        if built is None:
            return VariableResult(
                nodes=[],
                available=False,
                state="unavailable",
                stale=False,
                version=None,
                warnings=warnings,
            )
        cache.entries = built
        cache.names = names
        cache.frame_key = frame_key
        cache.available = True
        cache.version = snapshot_id
        cache.pending_build = False
        if cache.over_budget():
            warnings.append(
                "Variable object budget reached; the tree was truncated to stay bounded."
            )
        if len(names) > MAX_VARIABLES:
            warnings.append(
                f"Only the first {MAX_VARIABLES} variables were inspected."
            )
        return VariableResult(
            nodes=[entry.render() for entry in cache.entries],
            available=True,
            state="full",
            stale=False,
            version=snapshot_id,
            warnings=warnings,
        )

    async def close(self, controller: MIController) -> None:
        """Delete every variable object; used when a session terminates."""
        try:
            await self._delete_all(controller)
        except Exception:  # pragma: no cover - teardown must never fail a close
            pass
        self.cache.invalidate(keep_available=False)

    # ------------------------------------------------------------------ query
    async def _variable_names(
        self, controller: MIController, warnings: list[str]
    ) -> tuple[tuple[str, ...], dict[str, bool]] | None:
        try:
            record = await controller.execute("-stack-list-variables --all-values")
        except MIError as exc:
            warnings.append(f"DWARF variable query failed: {exc}")
            return None
        payload = record.get("payload") or {}
        raw_variables = payload.get("variables") or []
        if not isinstance(raw_variables, list):
            raw_variables = []
        collected: list[str] = []
        arguments: dict[str, bool] = {}
        for raw in raw_variables[:MAX_VARIABLES]:
            if not isinstance(raw, dict):
                continue
            name = raw.get("name")
            if isinstance(name, str) and name:
                collected.append(name)
                arguments[name] = str(raw.get("arg", "0")) == "1"
        return tuple(collected), arguments

    # ------------------------------------------------------------------ build
    async def _build(
        self,
        controller: MIController,
        names: tuple[str, ...],
        arguments: dict[str, bool],
        warnings: list[str],
    ) -> list[_VarEntry] | None:
        budget = _Budget()
        roots: list[_VarEntry] = []
        try:
            for name in names:
                if not budget.take_node():
                    break
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
                if not isinstance(var_name, str) or not isinstance(type_name, str):
                    # A failed/partial creation must never leave an object behind.
                    if isinstance(var_name, str):
                        self.cache.object_count += 1
                    continue
                self.cache.object_count += 1
                entry = await self._build_entry(
                    controller,
                    var_name=var_name,
                    display_name=name,
                    type_name=type_name,
                    raw_value=created_payload.get("value"),
                    is_argument=arguments.get(name, False),
                    frame_level=0,
                    depth=0,
                    budget=budget,
                )
                roots.append(entry)
        except (MIError, ValueError) as exc:
            warnings.append(f"Variable tree build failed: {exc}")
        if budget.warnings:
            warnings.extend(budget.warnings)
        return roots

    async def _build_entry(
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
    ) -> _VarEntry:
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
        else:
            location_kind = "unknown"

        entry = _VarEntry(
            var_name=var_name,
            name=display_name,
            type=type_name,
            value=None if optimized or synthetic else value,
            address=address,
            size_bytes=None,
            location_kind=location_kind,
            kind=kind,
            is_argument=is_argument,
            frame_level=frame_level,
            depth=depth,
        )

        # The graphical stack map needs the real byte extent of every top-level
        # variable. Only DWARF (via GDB) can answer this exactly, so measure it
        # instead of inferring a size from the type string. One extra MI command
        # per root variable, only when the tree is (re)built.
        if path and depth == 0:
            try:
                size_record = await controller.execute(
                    f"-data-evaluate-expression {_mi_quote(f'sizeof({path})')}"
                )
                entry.size_bytes = _first_int(
                    (size_record.get("payload") or {}).get("value")
                )
            except (MIError, ValueError):
                entry.size_bytes = None

        if kind == "string":
            children = await self._children(controller, var_name)
            entry.string_value = _quoted_string(value) or self._string_from_children(
                children
            )
            entry.children = []
            return entry

        if kind == "pointer":
            entry.pointer_target = _first_hex(value)
            if synthetic:
                entry.target_readable = False
                entry.target_source = "dwarf"
            else:
                await self._read_pointer_target(
                    controller, entry, budget, as_string=bool(
                        _CHAR_POINTER_RE.match(type_name)
                    )
                )
            return entry

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
                self.cache.object_count += 1
                entry.children.append(
                    await self._build_entry(
                        controller,
                        var_name=child_name,
                        display_name=child_exp
                        if isinstance(child_exp, str) and child_exp
                        else child_name,
                        type_name=child_type,
                        raw_value=child.get("value"),
                        is_argument=False,
                        frame_level=frame_level,
                        depth=depth + 1,
                        budget=budget,
                    )
                )
        return entry

    # ----------------------------------------------------------------- update
    async def _refresh(
        self, controller: MIController, snapshot_id: int
    ) -> list[_VarEntry] | None:
        """Refresh cached values with ``-var-update``; ``None`` means rebuild."""
        try:
            record = await controller.execute("-var-update --all-values *")
        except MIError:
            return None
        payload = record.get("payload") or {}
        changelist = payload.get("changelist")
        if changelist is None:
            return None
        changed: dict[str, str | None] = {}
        for item in changelist if isinstance(changelist, list) else []:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if not isinstance(name, str):
                continue
            if str(item.get("in_scope", "true")).lower() == "false":
                # The object is out of scope: its cached values are no longer
                # measurable, so a rebuild is the only truthful path.
                return None
            if str(item.get("type_changed", "false")).lower() == "true":
                return None
            changed[name] = item.get("value")

        budget = _Budget()
        for entry in self.cache.entries:
            if not await self._apply_update(controller, entry, changed, budget):
                return None
        return self.cache.entries

    async def _apply_update(
        self,
        controller: MIController,
        entry: _VarEntry,
        changed: dict[str, str | None],
        budget: _Budget,
    ) -> bool:
        if entry.var_name in changed:
            raw = changed[entry.var_name]
            value = str(raw) if raw is not None else None
            if value is not None and "<optimized out>" in value:
                entry.value = None
                entry.location_kind = "optimized_out"
            elif value is not None and "<synthetic" in value.lower():
                entry.value = None
                entry.location_kind = "unavailable"
            else:
                entry.value = value
                if entry.location_kind in {"optimized_out", "unavailable"}:
                    # The object became measurable again; do not keep claiming
                    # the old "optimized out" state.
                    entry.location_kind = "memory" if entry.address else "unknown"

        if entry.kind == "string":
            children = await self._children(controller, entry.var_name)
            if children:
                entry.string_value = self._string_from_children(children)
            return True

        if entry.kind == "pointer":
            if entry.location_kind in {"optimized_out", "unavailable"}:
                return True
            target = _first_hex(entry.value)
            changed = target != entry.pointer_target
            entry.pointer_target = target
            if changed:
                # The old bytes belonged to a different address; they must never
                # be shown for the new pointer value.
                entry.target_bytes = None
                entry.target_string = None
                entry.target_readable = None
                entry.target_source = None
            if target is None or target == "0x0000000000000000":
                entry.target_readable = False
                entry.target_source = "gdb-memory"
                return True
            # Re-read when the pointer changed (mandatory) or while the bounded
            # budget allows. Otherwise keep the last observed bytes but label
            # them as cached instead of pretending they were just read.
            if changed or budget.pointer_reads < MAX_POINTER_READS // 2:
                await self._read_pointer_target(
                    controller,
                    entry,
                    budget,
                    as_string=bool(_CHAR_POINTER_RE.match(entry.type)),
                )
            elif entry.target_bytes is not None:
                entry.target_source = "cache"
            return True

        if entry.children:
            children = await self._children(controller, entry.var_name)
            if not children:
                return False
            by_name = {
                str(child.get("name")): child
                for child in children
                if isinstance(child.get("name"), str)
            }
            for child_entry in entry.children:
                child_raw = by_name.get(child_entry.var_name)
                if child_raw is None:
                    return False
                value = child_raw.get("value")
                child_changed = {
                    child_entry.var_name: str(value) if value is not None else None
                }
                if not await self._apply_update(
                    controller, child_entry, child_changed, budget
                ):
                    return False
        return True

    async def _children(
        self, controller: MIController, var_name: str
    ) -> list[dict]:
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

    # ----------------------------------------------------------------- cleanup
    async def _delete_all(self, controller: MIController) -> None:
        for entry in self.cache.entries:
            try:
                await controller.execute(f"-var-delete {entry.var_name}")
            except MIError:
                continue
        self.cache.object_count = 0

    # ----------------------------------------------------------------- pointer
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
        entry: _VarEntry,
        budget: _Budget,
        *,
        as_string: bool,
    ) -> None:
        target = parse_hex_int(entry.pointer_target)
        if target is None or target == 0:
            entry.target_readable = False
            entry.target_source = "gdb-memory"
            return
        if (
            budget.pointer_reads >= MAX_POINTER_READS
            or budget.memory_bytes >= MAX_POINTER_READS * POINTER_READ_BYTES
        ):
            entry.target_readable = None
            entry.target_source = "not-read"
            return
        budget.pointer_reads += 1
        try:
            record = await controller.execute(
                f"-data-read-memory-bytes {hex64(target)} {POINTER_READ_BYTES}"
            )
        except MIError:
            entry.target_readable = False
            entry.target_source = "gdb-memory"
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
            entry.target_readable = False
            entry.target_source = "gdb-memory"
            return
        budget.memory_bytes += len(data)
        entry.target_bytes = bytes(data).hex()
        entry.target_readable = True
        entry.target_source = "gdb-memory"
        if as_string:
            terminated = bytes(data).split(b"\x00", 1)[0]
            entry.target_string = (
                terminated.decode("utf-8", errors="replace") if terminated else None
            )


__all__ = ["VariableCache", "VariableCollector", "VariableResult"]
