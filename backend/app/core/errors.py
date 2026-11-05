"""Error types shared by the API and debugger layers.

Every error surfaced to the browser carries a stable machine-readable ``code`` so
the UI can render specific guidance (missing GDB, unsupported version, ...).

V1.1 adds optional ``params``: the structured values a front-end needs to build a
localized sentence (``{"state": "RUNNING", "required": "STOPPED"}``). The English
``message`` is kept unchanged for compatibility, logs and non-i18n clients.
"""

from __future__ import annotations

from typing import Any


class PwnvizError(Exception):
    """Base class for errors that map onto an HTTP response."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(
        self,
        message: str,
        *,
        detail: Any | None = None,
        params: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.params: dict[str, Any] = params or {}

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.params:
            payload["params"] = self.params
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


class SessionStateError(PwnvizError):
    """An action is not valid for the session's current state."""

    status_code = 409
    code = "invalid_session_state"


class SampleNotBuiltError(PwnvizError):
    """The teaching sample exists but its ELF has not been compiled yet."""

    status_code = 409
    code = "sample_not_built"


class SampleSourceUnavailableError(PwnvizError):
    """The sample source exists in the registry but could not be read safely."""

    status_code = 500
    code = "sample_source_unavailable"


class DebuggerError(PwnvizError):
    """The debugger backend failed in a way the API reports as a gateway error."""

    status_code = 502
    code = "debugger_error"


class DebuggerTimeoutError(PwnvizError):
    """GDB accepted a command but did not report the expected stop in time."""

    status_code = 504
    code = "debugger_timeout"


class SessionClosedError(PwnvizError):
    """The session was terminated while an operation was in flight."""

    status_code = 409
    code = "session_closed"


class TooManySessionsError(PwnvizError):
    """The process-wide session limit has been reached."""

    status_code = 429
    code = "too_many_sessions"
