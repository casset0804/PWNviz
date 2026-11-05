"""Regression: a previous snapshot without an instruction must not abort a stop.

``Snapshot.instruction`` is optional (disassembly can fail for a stop), so the
frame-refresh policy must tolerate ``previous.instruction is None`` instead of
raising ``AttributeError`` and losing the following snapshot entirely.
"""

from __future__ import annotations

from app.collector.snapshot import previous_mnemonic
from app.schemas.snapshot import InstructionModel, Snapshot


def _snapshot(*, instruction: InstructionModel | None) -> Snapshot:
    return Snapshot(
        session_id="sess_test",
        snapshot_id=1,
        timestamp="2026-11-05T00:00:00Z",
        state="STOPPED",
        instruction=instruction,
    )


def test_previous_mnemonic_without_previous_snapshot() -> None:
    assert previous_mnemonic(None) is None


def test_previous_mnemonic_without_instruction() -> None:
    assert previous_mnemonic(_snapshot(instruction=None)) is None


def test_previous_mnemonic_reads_the_executed_instruction() -> None:
    snapshot = _snapshot(
        instruction=InstructionModel(
            address="0x0000000000401178",
            mnemonic="call",
            text="call 0x401136 <add_numbers>",
        )
    )
    assert previous_mnemonic(snapshot) == "call"
