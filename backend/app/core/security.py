"""Local-only deployment guards.

PWNviz is a single-user tool: the backend spawns GDB and can therefore spawn
processes. Binding it to a non-loopback interface must be an explicit decision,
and browser requests from another origin must not silently drive it.
"""

from __future__ import annotations

import ipaddress
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - import cycle preservation
    from app.core.config import Settings

WILDCARD_BIND_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})


def _strip_host(host: str) -> str:
    value = host.strip().lower()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    # Tolerate "host:port" and bare IPv6 forms.
    if value.count(":") == 1:
        value = value.split(":", 1)[0]
    return value


def is_loopback_host(host: str) -> bool:
    """True for localhost / 127.0.0.0/8 / ::1, false for wildcard binds."""
    value = _strip_host(host)
    if value in WILDCARD_BIND_HOSTS:
        return False
    if value == "localhost":
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def bind_guard_error(settings: "Settings") -> str | None:
    """Return a refusal message when a non-loopback bind lacks explicit opt-in."""
    if is_loopback_host(settings.api_host) or settings.allow_remote:
        return None
    return (
        f"Refusing to bind PWNviz to {settings.api_host!r}: this debugger spawns "
        "GDB and is local-only by design. Use API_HOST=127.0.0.1, or set "
        "PWNVIZ_ALLOW_REMOTE=1 deliberately (and configure "
        "PWNVIZ_ALLOWED_HOSTS) if you understand the exposure."
    )
