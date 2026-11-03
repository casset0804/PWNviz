"""Capability discovery endpoint.

Probes are real (they spawn GDB) and cached briefly: the default probe is cheap,
while ``?verify_pwndbg=true`` additionally loads pwndbg into a throwaway GDB.
"""

from __future__ import annotations

import asyncio
import platform
import time
from typing import cast

from fastapi import APIRouter, Query

from app import __version__
from app.core.config import Settings, get_settings
from app.core.errors import CapabilityProbeError
from app.core.logging import get_logger
from app.debugger.environment import detect_architecture, probe_gdb, probe_pwndbg
from app.samples.registry import discover_samples
from app.schemas.capabilities import (
    CapabilitiesResponse,
    GdbInfo,
    GdbPythonInfo,
    PlatformInfo,
    PwndbgInfo,
    PwndbgStatus,
    PythonInfo,
    SamplesSummary,
)
from app.schemas.common import utc_now_iso

router = APIRouter(tags=["capabilities"])
logger = get_logger("pwnviz.capabilities")

_QUICK = "quick"
_VERIFIED = "verified"
_cache: dict[str, tuple[float, CapabilitiesResponse]] = {}
_cache_lock = asyncio.Lock()


async def build_capabilities(
    settings: Settings, *, verify_pwndbg: bool = False
) -> CapabilitiesResponse:
    """Run every probe and assemble the capability report."""
    gdb_probe, pwndbg_probe = await asyncio.gather(
        probe_gdb(settings),
        probe_pwndbg(settings, verify=verify_pwndbg),
    )
    samples = discover_samples(settings.samples_dir)
    architecture = detect_architecture()

    warnings: list[str] = []
    if not architecture.is_x86_64:
        warnings.append(
            f"Host architecture is {architecture.machine or 'unknown'}, not x86-64; "
            "the PWNviz MVP only supports x86-64 Linux ELF targets."
        )
    if not gdb_probe.available:
        warnings.append(
            gdb_probe.error or f"GDB binary {settings.gdb_binary!r} is not available."
        )
    else:
        if not gdb_probe.supported:
            warnings.append(
                f"GDB {gdb_probe.version} is below the required "
                f"{gdb_probe.minimum_version}; collect results may be unreliable."
            )
        if not gdb_probe.supports_mi3:
            warnings.append(
                "GDB rejected `--interpreter=mi3`; PWNviz requires the MI3 interface."
            )
        if not gdb_probe.python.available:
            warnings.append(
                gdb_probe.python.error
                or "GDB has no embedded Python interpreter available."
            )

    if pwndbg_probe.status == "load_failed":
        warnings.append(pwndbg_probe.detail or "pwndbg failed to load; using native GDB.")
    elif pwndbg_probe.status == "not_found" and settings.load_pwndbg:
        warnings.append(
            "pwndbg was not found; native GDB will be used (fully supported)."
        )

    if not samples:
        warnings.append(
            f"No teaching samples found under {settings.samples_dir}; "
            "add a sample directory containing demo.c."
        )
    else:
        unbuilt = [sample.id for sample in samples if not sample.binary_exists]
        if unbuilt:
            warnings.append(
                "Samples without a compiled binary: "
                f"{', '.join(unbuilt)}. Run scripts/build_samples.sh first."
            )

    ready = (
        gdb_probe.available
        and gdb_probe.supported
        and gdb_probe.supports_mi3
        and gdb_probe.python.available
        and architecture.is_x86_64
    )

    return CapabilitiesResponse(
        generated_at=utc_now_iso(),
        service_version=__version__,
        platform=PlatformInfo(
            system=platform.system(),
            release=platform.release(),
            machine=architecture.machine,
            architecture=architecture.display,
            is_x86_64=architecture.is_x86_64,
            hostname=platform.node(),
        ),
        python=PythonInfo(
            backend_version=platform.python_version(),
            gdb_embedded_version=gdb_probe.python.version,
        ),
        gdb=GdbInfo(
            available=gdb_probe.available,
            path=gdb_probe.path,
            version=gdb_probe.version,
            minimum_version=gdb_probe.minimum_version,
            supported=gdb_probe.supported,
            supports_mi3=gdb_probe.supports_mi3,
            python=GdbPythonInfo(
                available=gdb_probe.python.available,
                version=gdb_probe.python.version,
                error=gdb_probe.python.error,
            ),
            error=gdb_probe.error,
            duration_ms=gdb_probe.duration_ms,
        ),
        pwndbg=PwndbgInfo(
            status=cast(PwndbgStatus, pwndbg_probe.status),
            path=pwndbg_probe.path,
            gdbinit=pwndbg_probe.gdbinit,
            verified=pwndbg_probe.verified,
            version=pwndbg_probe.version,
            detail=pwndbg_probe.detail,
            enabled=pwndbg_probe.enabled,
        ),
        samples=SamplesSummary(
            directory=str(settings.samples_dir),
            count=len(samples),
        ),
        ready=ready,
        warnings=warnings,
    )


async def _safe_build(
    settings: Settings, *, verify_pwndbg: bool
) -> CapabilitiesResponse:
    """Run the probe pipeline and convert unexpected failures into API errors."""
    try:
        return await build_capabilities(settings, verify_pwndbg=verify_pwndbg)
    except CapabilityProbeError:
        raise
    except Exception as exc:  # defensive: never leak a raw 500 to the browser
        logger.exception("capability probe failed unexpectedly")
        raise CapabilityProbeError(
            "Capability probe failed unexpectedly.",
            detail={"error": f"{type(exc).__name__}: {exc}"},
        ) from exc


@router.get("/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities(
    verify_pwndbg: bool = Query(
        default=False,
        description="Actually load pwndbg into a throwaway GDB to prove it works.",
    )
) -> CapabilitiesResponse:
    settings = get_settings()
    ttl = settings.capabilities_cache_seconds
    now = time.monotonic()

    async with _cache_lock:
        verified_cached = _cache.get(_VERIFIED)
        if verified_cached and verified_cached[0] > now:
            return verified_cached[1]

        if not verify_pwndbg:
            quick_cached = _cache.get(_QUICK)
            if quick_cached and quick_cached[0] > now:
                return quick_cached[1]

        result = await _safe_build(settings, verify_pwndbg=verify_pwndbg)
        expiry = time.monotonic() + ttl

        if verify_pwndbg:
            # Only successful verification is cached. A failed load must stay
            # retryable so the UI's "verify pwndbg load" button is not stuck for
            # the whole TTL after a transient failure.
            if result.pwndbg.verified:
                _cache[_VERIFIED] = (expiry, result)
                _cache[_QUICK] = (expiry, result)
        else:
            _cache[_QUICK] = (expiry, result)
        return result


def reset_capability_cache() -> None:
    """Test helper: forget cached probe results."""
    _cache.clear()


__all__ = [
    "router",
    "build_capabilities",
    "reset_capability_cache",
]
