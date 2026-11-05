"""Teaching sample listing endpoints (read-only in Phase 0)."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.errors import SampleNotFoundError, SampleSourceUnavailableError
from app.samples.registry import SampleRecord, discover_samples, get_sample
from app.schemas.samples import SampleInfo, SampleSource, SamplesResponse

router = APIRouter(tags=["samples"])

MAX_SOURCE_BYTES = 512 * 1024

_LANGUAGE_BY_SUFFIX = {
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".rs": "rust",
    ".py": "python",
}


def _to_info(record: SampleRecord) -> SampleInfo:
    return SampleInfo(
        id=record.id,
        title=record.title,
        description=record.description,
        directory=str(record.directory),
        source_file=str(record.source_file),
        binary_file=str(record.binary_file),
        binary_exists=record.binary_exists,
        binary_size=record.binary_size,
        binary_built_at=record.binary_built_at,
        build_command=record.build_command(),
    )


@router.get("/samples", response_model=SamplesResponse)
def list_samples() -> SamplesResponse:
    settings = get_settings()
    records = discover_samples(settings.samples_dir)
    return SamplesResponse(
        samples_dir=str(settings.samples_dir),
        count=len(records),
        samples=[_to_info(record) for record in records],
    )


@router.get("/samples/{sample_id}", response_model=SampleInfo)
def read_sample(sample_id: str) -> SampleInfo:
    settings = get_settings()
    record = get_sample(settings.samples_dir, sample_id)
    if record is None:
        raise SampleNotFoundError(
            f"Unknown sample {sample_id!r}.",
            detail={
                "available": [item.id for item in discover_samples(settings.samples_dir)]
            },
        )
    return _to_info(record)


@router.get("/samples/{sample_id}/source", response_model=SampleSource)
def read_sample_source(sample_id: str) -> SampleSource:
    """Return the sample's real source file for the source/disassembly panel.

    The path is not accepted from the client: it is re-resolved from the sample
    registry and must stay inside ``samples_dir``. Nothing is executed and the
    read is bounded, so a stray symlink or a huge file cannot be served.
    """
    settings = get_settings()
    record = get_sample(settings.samples_dir, sample_id)
    if record is None:
        raise SampleNotFoundError(
            f"Unknown sample {sample_id!r}.",
            params={"sample_id": sample_id},
            detail={
                "available": [item.id for item in discover_samples(settings.samples_dir)]
            },
        )

    try:
        resolved = record.source_file.resolve()
        root = settings.samples_dir.resolve()
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise OSError("source is outside the allowed sample root")
        with resolved.open("rb") as handle:
            raw = handle.read(MAX_SOURCE_BYTES + 1)
    except OSError as exc:
        raise SampleSourceUnavailableError(
            f"Source for sample {sample_id!r} is unavailable.",
            params={"sample_id": sample_id},
            detail={"error": type(exc).__name__, "reason": str(exc)},
        ) from exc

    truncated = len(raw) > MAX_SOURCE_BYTES
    if truncated:
        raw = raw[:MAX_SOURCE_BYTES]
    content = raw.decode("utf-8", errors="replace")
    return SampleSource(
        sample_id=record.id,
        source_file=str(record.source_file),
        language=_LANGUAGE_BY_SUFFIX.get(record.source_file.suffix.lower(), "text"),
        content=content,
        line_count=len(content.splitlines()),
        truncated=truncated,
    )
