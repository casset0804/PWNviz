"""Teaching sample listing endpoints (read-only in Phase 0)."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.errors import SampleNotFoundError
from app.samples.registry import SampleRecord, discover_samples, get_sample
from app.schemas.samples import SampleInfo, SamplesResponse

router = APIRouter(tags=["samples"])


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
