import { describe, expect, it } from "vitest";

import type { Snapshot, StackRow } from "../types/debug";
import {
  changedBytesMap,
  findCell,
  isAddressInWindow,
  markersForRow,
  previousRegisterValue,
} from "./snapshot";

// Test-only fixture. This is clearly a unit-test fixture, not application data.
function fixtureRow(address: string, bytes: Array<string | null>): StackRow {
  return {
    address,
    bytes,
    readable: bytes.every((byte) => byte !== null),
    qword_le: bytes.every((byte) => byte !== null) ? "0x0000000000000000" : null,
    ascii: bytes.every((byte) => byte !== null) ? "........" : null,
    annotations: [],
    changed_byte_offsets: [],
  };
}

function fixtureSnapshot(
  snapshotId: number,
  registers: Record<string, string | null>,
  rows: StackRow[],
): Snapshot {
  return {
    session_id: "sess_fixture",
    snapshot_id: snapshotId,
    timestamp: "2026-11-03T00:00:00Z",
    state: "STOPPED",
    stop_reason: "end-stepping-range",
    architecture: "x86-64",
    endianness: "little",
    pointer_bits: 64,
    registers,
    frames: [],
    instruction: null,
    disassembly: [],
    stack: {
      range_start: "0x00007fffffffe1f0",
      range_end: "0x00007fffffffe3f0",
      word_size: 8,
      rows,
      unreadable_ranges: [],
    },
    diff: {
      previous_snapshot_id: snapshotId > 1 ? snapshotId - 1 : null,
      changed_registers: snapshotId > 1 ? ["rip"] : [],
      changed_bytes:
        snapshotId > 1
          ? [
              {
                address: "0x00007fffffffe274",
                before: "00",
                after: "0a",
              },
            ]
          : [],
      window_changed: false,
    },
    warnings: [],
  };
}

describe("snapshot derivations", () => {
  const previous = fixtureSnapshot(
    1,
    {
      rip: "0x0000000000401160",
      rsp: "0x00007fffffffe270",
      rbp: "0x00007fffffffe280",
    },
    [fixtureRow("0x00007fffffffe270", ["00", "10", "00", "00", "00", "00", "00", "00"])],
  );
  const current = fixtureSnapshot(
    2,
    {
      rip: "0x0000000000401167",
      rsp: "0x00007fffffffe270",
      rbp: "0x00007fffffffe280",
    },
    [
      fixtureRow("0x00007fffffffe270", [
        "00",
        "10",
        "00",
        "00",
        "0a",
        "00",
        "00",
        "00",
      ]),
    ],
  );
  current.stack.range_start = previous.stack.range_start;
  current.stack.range_end = previous.stack.range_end;

  it("derives RSP/RBP byte offsets from register values", () => {
    const markers = markersForRow(current.stack.rows[0], current.registers.rsp, current.registers.rbp);
    expect(markers).toEqual([{ kind: "RSP", offset: 0 }]);
    const rbpRow = markersForRow(
      fixtureRow("0x00007fffffffe280", ["00"]),
      current.registers.rsp,
      current.registers.rbp,
    );
    expect(rbpRow).toEqual([{ kind: "RBP", offset: 0 }]);
  });

  it("does not force an outside RSP marker into a row", () => {
    const outside = "0x00007ffffffff000";
    expect(markersForRow(current.stack.rows[0], outside, null)).toEqual([]);
    expect(isAddressInWindow(current, outside)).toBe(false);
    expect(isAddressInWindow(current, current.registers.rsp)).toBe(true);
  });

  it("produces a changed-byte map keyed by canonical addresses", () => {
    const changed = changedBytesMap(current);
    expect(changed.get("0x00007fffffffe274")?.before).toBe("00");
    expect(changed.get("0x00007fffffffe274")?.after).toBe("0a");
    expect(changedBytesMap(previous).size).toBe(0);
  });

  it("finds a selected byte and preserves unreadable nulls", () => {
    const cell = findCell(current, "0x00007fffffffe274");
    expect(cell?.offset).toBe(4);
    expect(cell?.byte).toBe("0a");

    const unreadable = fixtureSnapshot(3, {}, [
      fixtureRow("0x00007fffffffe270", [null, "10", "00", "00", "00", "00", "00", "00"]),
    ]);
    const missing = findCell(unreadable, "0x00007fffffffe270");
    expect(missing?.byte).toBeNull();
    expect(unreadable.stack.rows[0].readable).toBe(false);
    expect(unreadable.stack.rows[0].qword_le).toBeNull();
  });

  it("returns previous register values only for the matching previous snapshot", () => {
    expect(previousRegisterValue(current, previous, "rip")).toBe(
      "0x0000000000401160",
    );
    expect(previousRegisterValue(current, null, "rip")).toBeNull();
    const mismatched = { ...previous, snapshot_id: 99 };
    expect(previousRegisterValue(current, mismatched, "rip")).toBeNull();
  });
});
