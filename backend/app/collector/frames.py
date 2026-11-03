"""Stack frame collection using GDB's unwinder (not an RBP assumption)."""

from __future__ import annotations

from typing import Any

from app.collector.common import normalize_hex
from app.debugger.mi_controller import MIController, MIError
from app.schemas.snapshot import FrameModel


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


class FrameCollector:
    def __init__(self, max_frames: int) -> None:
        self.max_frames = max(1, min(max_frames, 128))

    async def collect(
        self, controller: MIController
    ) -> tuple[list[FrameModel], list[str]]:
        warnings: list[str] = []
        try:
            record = await controller.execute(
                f"-stack-list-frames 0 {self.max_frames - 1}"
            )
        except MIError as exc:
            return [], [f"Stack frame query failed: {exc}"]

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
        if not frames:
            warnings.append("GDB reported no stack frames.")
        frames.sort(key=lambda frame: frame.level)
        return frames, warnings
