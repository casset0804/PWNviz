"""Real-GDB variable semantics matrix: DWARF, no-debug, -O2, fomit-frame-pointer."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from app.samples.registry import SampleRecord
from app.sessions.session import DebugSession
from app.sessions.state import SessionState

pytestmark = pytest.mark.integration

SOURCE = r"""
#include <string.h>
struct Point { int x; int y; };
int add(int a, int b) { return a + b; }
__attribute__((noinline)) int var_demo(int input) {
    int local_int = 42;
    char text[] = "hello";
    int arr[3] = {1, 2, 3};
    struct Point p = {7, 8};
    int *ptr = &local_int;
    const char *msg = "world";
    int *bad = (int *)0x1;
    return add(local_int, input) + arr[1] + p.x + (int)strlen(text)
        + *ptr + (int)strlen(msg) + (bad != 0);
}
int main(void) { return var_demo(5); }
"""


def _compile(tmp_path: Path, flags: list[str]) -> tuple[Path, Path]:
    source = tmp_path / "vars.c"
    binary = tmp_path / "vars"
    source.write_text(SOURCE, encoding="utf-8")
    result = subprocess.run(
        ["gcc", *flags, "-o", str(binary), str(source)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        pytest.fail(f"gcc failed: {result.stderr}")
    return source, binary


def _sample(tmp_path: Path, source: Path, binary: Path) -> SampleRecord:
    return SampleRecord(
        id="vars",
        title="variable fixture",
        description=None,
        directory=tmp_path,
        source_file=source,
        binary_file=binary,
    )


async def _stop_at_var_demo(
    settings, sample: SampleRecord, *, steps: int
) -> object:
    session = DebugSession(
        session_id="sess_vars",
        settings=settings,
        sample=sample,
        stop_at="var_demo",
        load_pwndbg_enabled=False,
    )
    try:
        snapshot = await session.launch()
        assert snapshot is not None
        for _ in range(steps):
            assert session.state is SessionState.STOPPED
            _, snapshot = await session.action("next")
            assert snapshot is not None
        return snapshot
    finally:
        await session.terminate()


@pytest.mark.skipif(
    shutil.which("gcc") is None or shutil.which("gdb") is None,
    reason="requires gcc and gdb",
)
async def test_debug_info_variables_and_complex_types(
    tmp_path: Path, make_settings
) -> None:
    source, binary = _compile(
        tmp_path, ["-g", "-O0", "-fno-omit-frame-pointer", "-fno-inline"]
    )
    settings = make_settings(
        samples_dir=tmp_path, allowed_sample_dir=tmp_path
    )
    snapshot = await _stop_at_var_demo(
        settings, _sample(tmp_path, source, binary), steps=8
    )

    assert snapshot.variables_available is True
    by_name = {node.name: node for node in snapshot.variables}
    assert by_name["input"].is_argument is True
    assert by_name["local_int"].value == "42"
    assert by_name["local_int"].location_kind == "memory"
    assert by_name["local_int"].address is not None
    # V1.2: sizes come from DWARF ``sizeof``, not from the type string.
    assert by_name["local_int"].size_bytes == 4
    assert by_name["text"].size_bytes == 6
    assert by_name["arr"].size_bytes == 12
    assert by_name["p"].size_bytes == 8
    assert by_name["ptr"].size_bytes == 8

    assert by_name["text"].kind == "string"
    assert by_name["text"].string_value == "hello"

    assert by_name["arr"].kind == "array"
    assert [child.value for child in by_name["arr"].children] == ["1", "2", "3"]

    assert by_name["p"].kind == "struct"
    assert {child.name: child.value for child in by_name["p"].children} == {
        "x": "7",
        "y": "8",
    }

    assert by_name["ptr"].kind == "pointer"
    assert by_name["ptr"].pointer_target is not None
    assert by_name["ptr"].target_readable is True
    assert by_name["msg"].target_string == "world"
    assert by_name["bad"].pointer_target == "0x0000000000000001"
    assert by_name["bad"].target_readable is False

    for node in snapshot.variables:
        assert node.source == "dwarf"
        assert node.confidence == "debug-info"


@pytest.mark.skipif(
    shutil.which("gcc") is None or shutil.which("gdb") is None,
    reason="requires gcc and gdb",
)
async def test_no_debug_info_keeps_raw_memory(
    tmp_path: Path, make_settings
) -> None:
    source, binary = _compile(
        tmp_path, ["-O0", "-fno-omit-frame-pointer", "-fno-pie", "-no-pie"]
    )
    settings = make_settings(
        samples_dir=tmp_path, allowed_sample_dir=tmp_path
    )
    snapshot = await _stop_at_var_demo(
        settings, _sample(tmp_path, source, binary), steps=0
    )

    assert snapshot.variables_available is False
    assert snapshot.variables == []
    assert snapshot.stack.rows
    assert snapshot.registers.get("rsp", "").startswith("0x")
    assert any("No DWARF variable information" in warning for warning in snapshot.warnings)


@pytest.mark.skipif(
    shutil.which("gcc") is None or shutil.which("gdb") is None,
    reason="requires gcc and gdb",
)
@pytest.mark.parametrize(
    "flags",
    [
        ["-g", "-O2"],
        ["-g", "-O2", "-fomit-frame-pointer"],
    ],
)
async def test_optimized_and_omit_frame_pointer_variants(
    tmp_path: Path, make_settings, flags: list[str]
) -> None:
    source, binary = _compile(tmp_path, [*flags, "-fno-inline"])
    settings = make_settings(
        samples_dir=tmp_path, allowed_sample_dir=tmp_path
    )
    snapshot = await _stop_at_var_demo(
        settings, _sample(tmp_path, source, binary), steps=0
    )

    assert snapshot.variables_available is True
    assert snapshot.stack.rows
    assert snapshot.frames
    # Optimized binaries commonly mark locals/pointers as optimized out or
    # synthetic; they must be represented, never silently dropped as raw zero.
    flattened = []

    def walk(nodes):
        for node in nodes:
            flattened.append(node)
            walk(node.children)

    walk(snapshot.variables)
    assert flattened
    assert any(
        node.location_kind in {"optimized_out", "unavailable", "register"}
        for node in flattened
    )
