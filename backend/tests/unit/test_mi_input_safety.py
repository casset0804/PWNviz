"""MI inputs derived from DWARF / filesystem must not inject MI lines."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.collector.variables import VariableCollector, _mi_quote
from app.core.config import get_settings
from app.core.errors import DebuggerError
from app.sessions.session import quote_mi_path


class RecordingController:
    def __init__(self) -> None:
        self.commands: list[str] = []

    async def execute(self, command: str, **_kwargs) -> dict:
        self.commands.append(command)
        assert command.startswith("-stack-list-variables"), command
        return {
            "type": "result",
            "message": "done",
            "payload": {
                "variables": [
                    {"name": "evil\n-exec-shell echo pwned", "value": "2"},
                ]
            },
        }


def test_mi_quote_rejects_line_breaks() -> None:
    with pytest.raises(ValueError):
        _mi_quote("evil\n-exec-shell echo pwned")
    with pytest.raises(ValueError):
        _mi_quote("evil\r-exec-shell echo pwned")


def test_sample_path_rejects_control_characters() -> None:
    with pytest.raises(DebuggerError):
        quote_mi_path(Path("/tmp/demo\n-exec-shell echo pwned"))


async def test_variable_name_injection_is_skipped_not_forwarded() -> None:
    controller = RecordingController()
    collector = VariableCollector(get_settings())

    result = await collector.collect(
        controller,  # type: ignore[arg-type]
        mode="full",
        has_debug_file=True,
        frame_key=None,
    )

    assert result.nodes == []
    assert result.available is True
    assert result.warnings
    assert all(
        "\n" not in command and "\r" not in command
        for command in controller.commands
    )
