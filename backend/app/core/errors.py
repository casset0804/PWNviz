"""Error types shared by the API and debugger layers.

Every error surfaced to the browser carries a stable machine-readable ``code`` so
the UI can render specific guidance (missing GDB, unsupported version, ...).
"""

from __future__ import annotations

from typing import Any


class PwnvizError(Exception):
    """Base class for errors that map onto an HTTP response."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, detail: Any | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.detail is not None:
            payload["detail"] = self.detail
        return payload


class DebuggerUnavailableError(PwnvizError):
    """GDB is missing or cannot be started on this host."""

    status_code = 503
    code = "debugger_unavailable"


class CapabilityProbeError(PwnvizError):
    """A capability probe ran but produced no usable result."""

    status_code = 503
    code = "capability_probe_failed"


class SampleNotFoundError(PwnvizError):
    """The requested teaching sample does not exist."""

    status_code = 404
    code = "sample_not_found"


class SessionNotFoundError(PwnvizError):
    """The requested debug session does not exist."""

    status_code = 404
    code = "session_not_found"
