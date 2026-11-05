"""Stack frame collection with an evidence-based refresh policy.

A fast snapshot must not re-unwind the whole call stack for every ``mov``. This
collector keeps the last GDB-unwinder result and refreshes it only when there is
positive evidence that the call stack could have changed:

* ``finish`` / ``continue`` / ``launch`` / ``step`` / ``next`` (source-level
  actions that may enter or leave frames);
* the instruction that just executed was ``call``/``callq``/``ret``/``retq``
  while single-stepping (the only instruction classes that push/pop a frame);
* GDB reported a ``breakpoint-hit``/``function-finished`` stop reason;
* a bounded safety interval elapsed, so an unnoticed drift cannot persist.

RBP is never used as evidence: it is a general-purpose register in optimized
code and PWNviz does not assume it is a frame pointer. While frames are served
from cache the snapshot says so (``frames_state="cached"``,
``frames_stale=True``) instead of pretending they were just re-read.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.collector.common import normalize_hex
from app.debugger.mi_controller import MIController, MIError
from app.schemas.snapshot import FrameModel

CALL_MNEMONICS = {"call", "callq"}
RETURN_MNEMONICS = {"ret", "retq"}
SOURCE_STEP_ACTIONS = {"step", "next", "finish", "continue", "launch", "run"}
FRAME_EXIT_REASONS = {
    "function-finished",
    "breakpoint-hit",
    "location-reached",
    "watchpoint-trigger",
    "read-watchpoint-trigger",
    "access-watchpoint-trigger",
    "exited-normally",
    "exited-signalled",
}


def _as_int(value: Any) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _normalize_frame(raw: dict[str, Any]) -> FrameModel | None:
    level = _as_int(raw.get("level"))
    if level is None:
        return None
    address = normalize_hex(raw.get("addr"))
    file_name = raw.get("fullname") or raw.get("file")
    return FrameModel(
        level=level,
        address=address,
        function=raw.get("func") or None,
        file=str(file_name) if file_name else None,
        line=_as_int(raw.get("line")),
    )


def frame_identity(frames: list[FrameModel]) -> tuple[Any, ...] | None:
    """Identity of the *frame instance*, not of the current instruction.

    ``FrameModel.address`` is the current PC for level 0, so it changes on every
    instruction and must not be part of the identity. The caller's return
    address (level 1) is stable while a callee is running, and the frame count
    distinguishes recursion depth. This is metadata evidence only.
    """
    if not frames:
        return None
    innermost = frames[0]
    caller = frames[1].address if len(frames) > 1 else None
    return (
        innermost.level,
        innermost.function,
        innermost.file,
        len(frames),
        caller,
    )


@dataclass
class FrameResult:
    frames: list[FrameModel]
    warnings: list[str] = field(default_factory=list)
    refreshed: bool = False
    state: str = "unavailable"
    version: int | None = None
    changed: bool = False
    key: tuple[Any, ...] | None = None


class FrameCollector:
    def __init__(self, max_frames: int, *, refresh_interval: int = 12) -> None:
        self.max_frames = max(1, min(max_frames, 128))
        self.refresh_interval = max(1, refresh_interval)
        self._frames: list[FrameModel] = []
        self._version: int | None = None
        self._key: tuple[Any, ...] | None = None
        self._since_refresh = 0
        self.last_reason: str | None = None

    def invalidate(self) -> None:
        self._frames = []
        self._key = None
        self._version = None

    def should_refresh(
        self,
        *,
        action: str | None,
        previous_mnemonic: str | None,
        stop_reason: str | None,
        force: bool,
    ) -> tuple[bool, str | None]:
        """Return ``(refresh, reason)`` with the concrete evidence for refresh."""
        if force or not self._frames:
            return True, "no cached frames"
        if stop_reason and stop_reason in FRAME_EXIT_REASONS:
            return True, f"stop reason {stop_reason}"
        if action in SOURCE_STEP_ACTIONS:
            return True, f"action {action}"
        mnemonic = (previous_mnemonic or "").lower()
        if mnemonic in CALL_MNEMONICS:
            return True, f"{mnemonic} executed"
        if mnemonic in RETURN_MNEMONICS:
            return True, f"{mnemonic} executed"
        if self._since_refresh >= self.refresh_interval:
            return True, f"{self._since_refresh} snapshots since last refresh"
        return False, None

    async def collect(
        self,
        controller: MIController,
        *,
        snapshot_id: int,
        action: str | None = None,
        previous_mnemonic: str | None = None,
        stop_reason: str | None = None,
        force: bool = False,
    ) -> FrameResult:
        refresh, reason = self.should_refresh(
            action=action,
            previous_mnemonic=previous_mnemonic,
            stop_reason=stop_reason,
            force=force,
        )
        if not refresh:
            self._since_refresh += 1
            return FrameResult(
                frames=list(self._frames),
                refreshed=False,
                state="cached",
                version=self._version,
                changed=False,
                key=self._key,
            )

        warnings: list[str] = []
        try:
            record = await controller.execute(
                f"-stack-list-frames 0 {self.max_frames - 1}"
            )
        except MIError as exc:
            # A failed refresh must not silently keep old frames as "fresh".
            if self._frames:
                return FrameResult(
                    frames=list(self._frames),
                    warnings=[f"Stack frame query failed: {exc}"],
                    refreshed=False,
                    state="cached",
                    version=self._version,
                    changed=False,
                    key=self._key,
                )
            return FrameResult(
                frames=[],
                warnings=[f"Stack frame query failed: {exc}"],
                refreshed=False,
                state="unavailable",
                version=None,
                changed=False,
                key=None,
            )

        payload = record.get("payload") or {}
        raw_frames = payload.get("stack") or []
        frames: list[FrameModel] = []
        for raw in raw_frames:
            if not isinstance(raw, dict):
                continue
            # GDB 12 returns flat entries; tolerate a nested "frame" shape too.
            candidate = raw.get("frame") if isinstance(raw.get("frame"), dict) else raw
            frame = _normalize_frame(candidate)
            if frame is not None:
                frames.append(frame)
        frames.sort(key=lambda frame: frame.level)
        if not frames:
            warnings.append("GDB reported no stack frames.")
        key = frame_identity(frames)
        changed = key != self._key
        self._frames = frames
        self._key = key
        self._version = snapshot_id
        self._since_refresh = 0
        self.last_reason = reason
        return FrameResult(
            frames=list(frames),
            warnings=warnings,
            refreshed=True,
            state="fresh" if frames else "unavailable",
            version=snapshot_id,
            changed=changed,
            key=key,
        )


__all__ = ["FrameCollector", "FrameResult", "frame_identity"]
