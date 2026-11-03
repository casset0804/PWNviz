"""Shared schema helpers."""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now_iso() -> str:
    """ISO-8601 UTC timestamp with a trailing ``Z`` (protocol requirement)."""
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def utc_from_timestamp(value: float) -> str:
    return (
        datetime.fromtimestamp(value, tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
