"""Health endpoint: cheap, never spawns GDB."""

from __future__ import annotations

import time

from fastapi import APIRouter

from app import __version__
from app.core.config import get_settings
from app.schemas.common import utc_now_iso

router = APIRouter(tags=["health"])

_STARTED_AT = time.monotonic()


@router.get("/health")
def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "pwnviz-backend",
        "version": __version__,
        "timestamp": utc_now_iso(),
        "uptime_seconds": round(time.monotonic() - _STARTED_AT, 3),
        "gdb_binary": settings.gdb_binary,
        "samples_dir": str(settings.samples_dir),
    }
