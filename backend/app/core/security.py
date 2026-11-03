"""Local-only deployment guards.

PWNviz is a single-user tool: the backend spawns GDB and can therefore spawn
processes. Binding it to a non-loopback interface must be an explicit decision,
and browser requests from another origin must not silently drive it.
"""

from __future__ import annotations

import ipaddress
from typing import TYPE_CHECKING

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

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
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        return address.ipv4_mapped.is_loopback
    return address.is_loopback


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


class LocalOnlyMiddleware:
    """Reject non-loopback clients even when uvicorn is launched directly.

    ``bind_guard_error`` only runs through ``python -m app``. A user can still
    invoke ``uvicorn app.main:app --host 0.0.0.0`` (or a process manager can),
    bypassing that guard. This ASGI middleware closes the lower-level hole for
    both HTTP and WebSocket clients unless remote access was explicitly enabled.
    TestClient/ASGI harnesses use the conventional ``testclient`` peer and remain
    allowed; an unknown peer is treated as non-local (fail closed).
    """

    def __init__(self, app: ASGIApp, *, allow_remote: bool) -> None:
        self.app = app
        self.allow_remote = allow_remote

    async def __call__(
        self, scope: Scope, receive: Receive, send: Send
    ) -> None:
        if (
            not self.allow_remote
            and scope.get("type") in {"http", "websocket"}
        ):
            raw_client = scope.get("client")
            client = raw_client[0] if raw_client else None
            if client != "testclient" and (
                client is None or not is_loopback_host(client)
            ):
                if scope["type"] == "websocket":
                    await send(
                        {
                            "type": "websocket.accept",
                        }
                    )
                    await send(
                        {
                            "type": "websocket.close",
                            "code": 4403,
                            "reason": "local-only server",
                        }
                    )
                else:
                    response = JSONResponse(
                        status_code=403,
                        content={
                            "error": {
                                "code": "non_local_client",
                                "message": (
                                    "PWNviz is local-only; non-loopback clients "
                                    "are not allowed unless PWNVIZ_ALLOW_REMOTE=1."
                                ),
                            }
                        },
                    )
                    await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


__all__ = ["is_loopback_host", "bind_guard_error", "LocalOnlyMiddleware"]
