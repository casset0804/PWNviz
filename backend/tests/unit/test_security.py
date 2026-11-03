"""Unit tests for the local-only deployment guards."""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.security import bind_guard_error, is_loopback_host


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("127.0.0.1", True),
        ("127.0.0.2", True),
        ("localhost", True),
        ("::1", True),
        ("[::1]", True),
        ("0.0.0.0", False),
        ("::", False),
        ("192.168.1.10", False),
        ("example.com", False),
        ("", False),
    ],
)
def test_is_loopback_host(host: str, expected: bool) -> None:
    assert is_loopback_host(host) is expected


def test_bind_guard_refuses_public_bind_by_default(make_settings) -> None:
    error = bind_guard_error(make_settings(api_host="0.0.0.0", allow_remote=False))

    assert error is not None
    assert "PWNVIZ_ALLOW_REMOTE=1" in error


def test_bind_guard_allows_explicit_remote(make_settings) -> None:
    assert bind_guard_error(make_settings(api_host="0.0.0.0", allow_remote=True)) is None


def test_bind_guard_allows_loopback(make_settings) -> None:
    assert bind_guard_error(make_settings(api_host="127.0.0.1")) is None


def test_public_api_host_is_added_to_trusted_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("API_HOST", "192.168.50.5")
    settings = get_settings()

    assert "192.168.50.5" in settings.allowed_hosts
    assert "127.0.0.1" in settings.allowed_hosts


def test_wildcard_bind_does_not_whitelist_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("API_HOST", "0.0.0.0")
    settings = get_settings()

    assert "0.0.0.0" not in settings.allowed_hosts
    assert settings.allow_remote is False


def test_allowed_hosts_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PWNVIZ_ALLOWED_HOSTS", "localhost,*.internal")
    settings = get_settings()

    assert settings.allowed_hosts == ("localhost", "*.internal")
