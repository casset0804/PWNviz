"""Integration tests: run the real FastAPI app and probe the real host toolchain.

These tests do not fake GDB. When GDB is absent the assertions switch to the
documented degraded behaviour; they are skipped only where CI cannot provide GDB.
"""

from __future__ import annotations

import shutil

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes_capabilities import reset_capability_cache
from app.core.config import get_settings
from app.debugger.environment import PwndbgProbe, pwndbg_candidates
from app.main import app

pytestmark = pytest.mark.integration


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http


async def test_invalid_host_header_is_rejected(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"host": "evil.example"})

    assert response.status_code == 400
    assert "Invalid host header" in response.text


async def test_cross_site_browser_request_is_rejected(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/samples", headers={"sec-fetch-site": "cross-site"}
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "cross_site_blocked"


async def test_cross_site_check_allows_same_origin_requests(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/samples", headers={"sec-fetch-site": "same-origin"}
    )

    assert response.status_code == 200


async def test_health_reports_configured_binary(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "pwnviz-backend"
    assert body["version"]
    assert body["gdb_binary"] == get_settings().gdb_binary


async def test_samples_lists_stack_basic(client: AsyncClient) -> None:
    response = await client.get("/api/v1/samples")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == len(body["samples"])
    samples = {sample["id"]: sample for sample in body["samples"]}
    assert "stack-basic" in samples, body
    sample = samples["stack-basic"]
    assert sample["source_file"].endswith("demo.c")
    assert sample["binary_file"].endswith("demo")
    assert "-no-pie" in sample["build_command"]


async def test_unknown_sample_returns_structured_error(client: AsyncClient) -> None:
    response = await client.get("/api/v1/samples/does-not-exist")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "sample_not_found"
    assert "stack-basic" in body["error"]["detail"]["available"]


async def test_sample_source_returns_real_demo_c(client: AsyncClient) -> None:
    response = await client.get("/api/v1/samples/stack-basic/source")

    assert response.status_code == 200
    body = response.json()
    assert body["sample_id"] == "stack-basic"
    assert body["source_file"].endswith("demo.c")
    assert body["language"] == "c"
    assert body["truncated"] is False
    assert "add_numbers" in body["content"]
    assert body["line_count"] >= 10


async def test_unknown_sample_source_returns_structured_error(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/v1/samples/does-not-exist/source")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "sample_not_found"


@pytest.mark.skipif(shutil.which("gdb") is None, reason="GDB not installed on host")
async def test_capabilities_probe_real_gdb(client: AsyncClient) -> None:
    response = await client.get("/api/v1/capabilities")

    assert response.status_code == 200
    body = response.json()
    assert body["platform"]["system"] == "Linux"
    assert body["platform"]["architecture"] == "x86-64"
    assert body["platform"]["is_x86_64"] is True
    assert body["python"]["backend_version"]
    assert body["gdb"]["available"] is True
    assert body["gdb"]["version"]
    assert body["gdb"]["supports_mi3"] is True
    assert body["gdb"]["python"]["available"] is True
    assert body["ready"] is True
    assert body["samples"]["count"] >= 1


async def test_capabilities_fail_cleanly_without_gdb(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GDB_PATH", "pwnviz-definitely-missing-gdb")
    get_settings.cache_clear()
    reset_capability_cache()

    response = await client.get("/api/v1/capabilities")

    assert response.status_code == 200
    body = response.json()
    assert body["gdb"]["available"] is False
    assert body["gdb"]["error"]
    assert body["ready"] is False
    assert any(
        "missing" in warning.lower() or "not found" in warning.lower()
        for warning in body["warnings"]
    )


async def test_unexpected_probe_error_is_structured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(_settings):  # noqa: ANN001 - test double
        raise RuntimeError("simulated probe crash")

    monkeypatch.setattr("app.api.routes_capabilities.probe_gdb", boom)
    reset_capability_cache()

    response = await client.get("/api/v1/capabilities")

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "capability_probe_failed"
    assert "simulated probe crash" in body["error"]["detail"]["error"]


async def test_capabilities_are_cached(client: AsyncClient) -> None:
    reset_capability_cache()
    first = (await client.get("/api/v1/capabilities")).json()
    second = (await client.get("/api/v1/capabilities")).json()

    assert first["generated_at"] == second["generated_at"]


@pytest.mark.skipif(shutil.which("gdb") is None, reason="GDB not installed on host")
async def test_pwndbg_verification_is_real(client: AsyncClient) -> None:
    settings = get_settings()
    if not pwndbg_candidates(settings):
        pytest.skip("pwndbg not installed on host")

    reset_capability_cache()
    response = await client.get("/api/v1/capabilities?verify_pwndbg=true")

    assert response.status_code == 200
    pwndbg = response.json()["pwndbg"]
    assert pwndbg["status"] in {"verified", "load_failed"}
    assert pwndbg["verified"] is (pwndbg["status"] == "verified")
    if pwndbg["verified"]:
        assert pwndbg["gdbinit"].endswith("gdbinit.py")


async def test_failed_pwndbg_verification_stays_retryable(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[bool] = []

    async def fake_probe(_settings, *, verify: bool = False) -> PwndbgProbe:
        calls.append(verify)
        return PwndbgProbe(
            status="load_failed",
            path=None,
            gdbinit=None,
            verified=False,
            version=None,
            detail="simulated transient pwndbg failure",
            enabled=True,
        )

    monkeypatch.setattr("app.api.routes_capabilities.probe_pwndbg", fake_probe)
    reset_capability_cache()

    first = await client.get("/api/v1/capabilities?verify_pwndbg=true")
    second = await client.get("/api/v1/capabilities?verify_pwndbg=true")

    assert first.status_code == second.status_code == 200
    assert first.json()["pwndbg"]["status"] == "load_failed"
    assert calls == [True, True], "failed verification must not be cached"
