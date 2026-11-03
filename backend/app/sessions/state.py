"""Debug session lifecycle states."""

from __future__ import annotations

from enum import Enum


class SessionState(str, Enum):
    CREATED = "CREATED"
    INITIALIZING = "INITIALIZING"
    READY = "READY"
    RUNNING = "RUNNING"
    STOPPED = "STOPPED"
    EXITED = "EXITED"
    ERROR = "ERROR"
    TERMINATED = "TERMINATED"
