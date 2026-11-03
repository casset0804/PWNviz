"""Formatting helpers shared by collectors and diffing."""

from __future__ import annotations

HEX_PREFIX = "0x"


def hex64(value: int) -> str:
    """Canonical 64-bit hex string used throughout the JSON protocol."""
    return f"0x{value & 0xFFFFFFFFFFFFFFFF:016x}"


def parse_hex_int(value: str | None) -> int | None:
    if not value:
        return None
    text = value.strip()
    if text.startswith("<") or not text.startswith(HEX_PREFIX):
        return None
    try:
        return int(text, 16)
    except ValueError:
        return None


def normalize_hex(value: str | None) -> str | None:
    """Normalize a GDB hex value; non-numeric placeholders become None."""
    parsed = parse_hex_int(value)
    return hex64(parsed) if parsed is not None else None


def align_down(value: int, alignment: int = 8) -> int:
    return value - (value % alignment)


def align_up(value: int, alignment: int = 8) -> int:
    return value if value % alignment == 0 else value + (alignment - value % alignment)


def printable_ascii(data: bytes) -> str:
    return "".join(chr(byte) if 0x20 <= byte <= 0x7E else "." for byte in data)


def hex_bytes(data: bytes) -> str:
    return data.hex()
