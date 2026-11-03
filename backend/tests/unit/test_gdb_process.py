"""Unit tests for persistent GDB command construction."""

from __future__ import annotations

from app.debugger.gdb_process import MI_INTERPRETER_FLAG, build_gdb_command


def test_default_command_is_persistent_mi3(make_settings) -> None:
    command = build_gdb_command(make_settings(gdb_binary="gdb"))

    assert command[0] == "gdb"
    assert "--batch" not in command
    assert "--quiet" in command
    assert MI_INTERPRETER_FLAG in command


def test_batch_is_removed_and_mi3_appended(make_settings) -> None:
    command = build_gdb_command(
        make_settings(
            gdb_binary="/usr/bin/gdb",
            gdb_args=("--batch", "--nx", "--quiet"),
        )
    )

    assert command == [
        "/usr/bin/gdb",
        "--nx",
        "--quiet",
        "--interpreter=mi3",
    ]


def test_configured_mi_arguments_are_preserved(make_settings) -> None:
    command = build_gdb_command(
        make_settings(
            gdb_binary="gdb",
            gdb_args=("--nx", "--interpreter=mi3", "-iex", "set pagination off"),
        )
    )

    assert command[0] == "gdb"
    assert "--quiet" in command
    assert "-iex" in command
    assert command.count("--interpreter=mi3") == 1
