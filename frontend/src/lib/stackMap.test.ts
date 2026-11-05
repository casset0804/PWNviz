import { describe, expect, it } from "vitest";

import { formatAddress } from "./address";
import {
  STACK_MAP_PX_PER_BYTE,
  buildStackMap,
  inferVariableSize,
  readSnapshotBytes,
  resolveVariableSize,
} from "./stackMap";
import type { Snapshot, StackRow, VariableNode } from "../types/debug";

const WINDOW_START = 0x7fffffffe200n;
const WINDOW_END = 0x7fffffffe300n;
const RSP = 0x7fffffffe260n;
const RBP = 0x7fffffffe270n;
const MAIN_RBP = 0x7fffffffe2a0n;
const LIBC_RBP = 0x7fffffffe2c0n;
const MAIN_RETURN = 0x40117dn;
const LIBC_RETURN = 0x7ffff7da1c40n;

function hex(value: bigint): string {
  return formatAddress(value);
}

function variable(overrides: Partial<VariableNode>): VariableNode {
  return {
    name: "v",
    type: "int",
    value: "0",
    address: null,
    size_bytes: null,
    location_kind: "memory",
    source: "dwarf",
    confidence: "debug-info",
    kind: "scalar",
    is_argument: false,
    frame_level: 0,
    children: [],
    string_value: null,
    pointer_target: null,
    target_readable: null,
    target_bytes: null,
    target_string: null,
    target_source: null,
    ...overrides,
  };
}

function writeQword(bytes: Map<bigint, string>, address: bigint, value: bigint): void {
  for (let index = 0; index < 8; index += 1) {
    const byte = Number((value >> BigInt(index * 8)) & 0xffn);
    bytes.set(address + BigInt(index), byte.toString(16).padStart(2, "0"));
  }
}

function writeDword(bytes: Map<bigint, string>, address: bigint, value: number): void {
  for (let index = 0; index < 4; index += 1) {
    bytes.set(address + BigInt(index), ((value >> (index * 8)) & 0xff).toString(16).padStart(2, "0"));
  }
}

function buildRows(bytes: Map<bigint, string>, overrides: Record<string, string | null> = {}): StackRow[] {
  const rows: StackRow[] = [];
  for (let start = WINDOW_START; start < WINDOW_END; start += 8n) {
    const key = hex(start);
    const cells: Array<string | null> = [];
    for (let index = 0; index < 8; index += 1) {
      cells.push(overrides[key] === undefined ? bytes.get(start + BigInt(index)) ?? null : overrides[key]);
    }
    rows.push({
      address: key,
      bytes: cells,
      readable: cells.every((cell) => cell !== null),
      qword_le: null,
      ascii: null,
      annotations: [],
      changed_byte_offsets: [],
    });
  }
  return rows;
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const bytes = new Map<bigint, string>();
  // add_numbers locals
  writeDword(bytes, 0x7fffffffe260n, 3);
  writeDword(bytes, 0x7fffffffe264n, 4);
  writeDword(bytes, 0x7fffffffe268n, 0x0a);
  // saved rbp of add_numbers -> main's rbp; return address -> main PC
  writeQword(bytes, RBP, MAIN_RBP);
  writeQword(bytes, 0x7fffffffe278n, MAIN_RETURN);
  // main locals: pointer p at e288 -> a at e290, a=10, b=20
  writeQword(bytes, 0x7fffffffe288n, 0x7fffffffe290n);
  writeDword(bytes, 0x7fffffffe290n, 10);
  writeDword(bytes, 0x7fffffffe294n, 20);
  writeDword(bytes, 0x7fffffffe298n, 0);
  // main's saved rbp -> libc rbp; return address -> libc PC
  writeQword(bytes, MAIN_RBP, LIBC_RBP);
  writeQword(bytes, 0x7fffffffe2a8n, LIBC_RETURN);

  const variables: VariableNode[] = [
    variable({ name: "x", address: hex(0x7fffffffe260n), value: "3", size_bytes: 4, is_argument: true }),
    variable({ name: "y", address: hex(0x7fffffffe264n), value: "4", size_bytes: 4, is_argument: true }),
    variable({ name: "sum", address: hex(0x7fffffffe268n), value: "10", size_bytes: 4 }),
    variable({
      name: "a",
      address: hex(0x7fffffffe290n),
      value: "10",
      size_bytes: 4,
      frame_level: 1,
    }),
    variable({
      name: "b",
      address: hex(0x7fffffffe294n),
      value: "20",
      size_bytes: 4,
      frame_level: 1,
    }),
    variable({
      name: "p",
      type: "int *",
      kind: "pointer",
      address: hex(0x7fffffffe288n),
      value: hex(0x7fffffffe290n),
      size_bytes: 8,
      pointer_target: hex(0x7fffffffe290n),
      target_readable: true,
      target_bytes: "0a000000",
      target_source: "gdb-memory",
      frame_level: 1,
    }),
  ];

  const rows = buildRows(bytes);
  return {
    session_id: "sess_test",
    snapshot_id: 2,
    timestamp: "2026-11-05T00:00:00Z",
    state: "STOPPED",
    stop_reason: "end-stepping-range",
    architecture: "x86-64",
    endianness: "little",
    pointer_bits: 64,
    registers: {
      rip: "0x0000000000401144",
      rsp: hex(RSP),
      rbp: hex(RBP),
      rax: "0x0000000000000000",
    },
    frames: [
      { level: 0, address: "0x0000000000401144", function: "add_numbers", file: "demo.c", line: 5 },
      { level: 1, address: hex(MAIN_RETURN), function: "main", file: "demo.c", line: 12 },
      { level: 2, address: hex(LIBC_RETURN), function: "__libc_start_call_main", file: null, line: null },
    ],
    instruction: {
      address: "0x0000000000401144",
      bytes: "8b45fc",
      mnemonic: "mov",
      operands: "eax, DWORD PTR [rbp-0x4]",
      text: "mov eax,DWORD PTR [rbp-0x4]",
      function: "add_numbers",
    },
    disassembly: [],
    stack: {
      range_start: hex(WINDOW_START),
      range_end: hex(WINDOW_END),
      word_size: 8,
      rows,
      unreadable_ranges: [],
    },
    diff: {
      previous_snapshot_id: 1,
      changed_registers: ["rip", "rsp"],
      changed_bytes: [
        { address: hex(0x7fffffffe268n), before: "00", after: "0a" },
      ],
      window_changed: true,
    },
    variables,
    variables_available: true,
    warnings: [],
    ...overrides,
  };
}

describe("buildStackMap frame derivation", () => {
  it("draws frames only when memory corroborates the unwound caller PC", () => {
    const model = buildStackMap(makeSnapshot());

    expect(model.available).toBe(true);
    expect(model.reason).toBe("ready");
    expect(model.frames.map((frame) => frame.function)).toEqual(["add_numbers", "main"]);
    expect(model.frames[0].verified).toBe(true);
    expect(model.frames[0].start).toBe(hex(RSP));
    expect(model.frames[0].end).toBe(hex(RBP + 16n));
    expect(model.frames[1].start).toBe(hex(RBP + 16n));
    expect(model.frames[1].end).toBe(hex(MAIN_RBP + 16n));

    const frame0 = model.frames[0];
    const saved = frame0.blocks.find((block) => block.kind === "saved-rbp");
    const returnAddress = frame0.blocks.find((block) => block.kind === "return-address");
    expect(saved?.start).toBe(hex(RBP));
    expect(saved?.value).toBe(hex(MAIN_RBP));
    expect(returnAddress?.start).toBe(hex(RBP + 8n));
    expect(returnAddress?.value).toBe(hex(MAIN_RETURN));

    const frame1 = model.frames[1];
    expect(frame1.returnAddress).toBe(hex(LIBC_RETURN));
    expect(frame1.savedRbp).toBe(hex(LIBC_RBP));
    // The third GDB frame is real, but its stack extent is outside the window.
    expect(model.callChain.map((entry) => entry.level)).toEqual([0, 1, 2]);
    expect(model.callChain[2].memoryVisible).toBe(false);
    expect(model.contentHeight).toBe(
      Number(WINDOW_END - WINDOW_START) * STACK_MAP_PX_PER_BYTE,
    );
  });

  it("never invents a frame when the saved RIP does not match the unwinder", () => {
    const snapshot = makeSnapshot();
    const badRows = snapshot.stack.rows.map((row) =>
      row.address === hex(0x7fffffffe278n)
        ? { ...row, bytes: ["00", "00", "00", "00", "00", "00", "00", "00"] }
        : row,
    );
    const model = buildStackMap({
      ...snapshot,
      stack: { ...snapshot.stack, rows: badRows },
    });

    expect(model.frames).toHaveLength(1);
    expect(model.frames[0].verified).toBe(false);
    expect(model.frames[0].function).toBe("add_numbers");
    expect(model.frames[0].savedRbpBlockId).toBeNull();
    expect(model.frames[0].returnAddressBlockId).toBeNull();
    // No block is allowed to claim "saved RBP" without verification.
    expect(model.blocks.some((block) => block.kind === "saved-rbp")).toBe(false);
    // The call chain is still GDB's real unwinder output.
    expect(model.callChain).toHaveLength(3);
  });

  it("uses the measured return-address slot when RBP is not a callee frame base", () => {
    const snapshot = makeSnapshot();
    const model = buildStackMap({
      ...snapshot,
      registers: { ...snapshot.registers, rbp: "0x0000000000000000" },
    });

    // The RBP chain is unusable, but [RSP+0x18] really contains main's return
    // address, so the entry frame only claims up to that verified slot.
    expect(model.frames).toHaveLength(1);
    expect(model.frames[0].verified).toBe(false);
    expect(model.frames[0].start).toBe(hex(RSP));
    expect(model.frames[0].end).toBe(hex(0x7fffffffe280n));
    expect(model.frames[0].returnAddress).toBe(hex(MAIN_RETURN));
    expect(model.frames[0].returnAddressBlockId).not.toBeNull();
    expect(model.frames[0].savedRbpBlockId).toBeNull();
  });

  it("draws the caller at function entry using the still-live caller RBP", () => {
    const snapshot = makeSnapshot();
    const entryRsp = 0x7fffffffe258n;
    const entryRows = snapshot.stack.rows.map((row) => {
      if (row.address !== hex(0x7fffffffe258n)) return row;
      const value = MAIN_RETURN;
      const bytes = Array.from({ length: 8 }, (_, index) =>
        Number((value >> BigInt(index * 8)) & 0xffn)
          .toString(16)
          .padStart(2, "0"),
      );
      return { ...row, bytes };
    });
    const model = buildStackMap({
      ...snapshot,
      registers: {
        ...snapshot.registers,
        rsp: hex(entryRsp),
        rbp: hex(MAIN_RBP),
      },
      frames: [
        { level: 0, address: "0x0000000000401136", function: "add_numbers", file: "demo.c", line: 4 },
        { level: 1, address: hex(MAIN_RETURN), function: "main", file: "demo.c", line: 12 },
        { level: 2, address: hex(LIBC_RETURN), function: "__libc_start_call_main", file: null, line: null },
      ],
      variables: [],
      stack: { ...snapshot.stack, rows: entryRows },
    });

    expect(model.frames).toHaveLength(2);
    expect(model.frames[0].function).toBe("add_numbers");
    expect(model.frames[0].verified).toBe(false);
    expect(model.frames[0].start).toBe(hex(entryRsp));
    expect(model.frames[0].end).toBe(hex(entryRsp + 8n));
    expect(model.frames[0].returnAddress).toBe(hex(MAIN_RETURN));

    const caller = model.frames[1];
    expect(caller.function).toBe("main");
    expect(caller.verified).toBe(true);
    expect(caller.start).toBe(hex(entryRsp + 8n));
    expect(caller.end).toBe(hex(MAIN_RBP + 16n));
    expect(caller.savedRbp).toBe(hex(LIBC_RBP));
    expect(caller.returnAddress).toBe(hex(LIBC_RETURN));
  });
});

describe("buildStackMap variable blocks", () => {
  it("places variables at their real addresses with their real DWARF size", () => {
    const model = buildStackMap(makeSnapshot());
    const blocks = model.blocks.filter((block) => block.kind === "variable");
    const x = blocks.find((block) => block.label === "x");
    const a = blocks.find((block) => block.label === "a");

    expect(x?.start).toBe(hex(0x7fffffffe260n));
    expect(x?.end).toBe(hex(0x7fffffffe264n));
    expect(x?.height).toBe(4 * STACK_MAP_PX_PER_BYTE);
    expect(x?.sizeSource).toBe("dwarf");
    expect(a?.start).toBe(hex(0x7fffffffe290n));
    // Caller-frame DWARF variables are placed when the backend provides them.
    expect(a?.frameLevel).toBe(1);

    // Gaps are real, explicitly unknown byte ranges, never renamed locals.
    const unknown = model.frames[0].unknownRanges.map((range) => range.start);
    expect(unknown).toContain(hex(0x7fffffffe26cn));
  });

  it("marks blocks containing changed bytes and keeps before/after evidence", () => {
    const model = buildStackMap(makeSnapshot());
    const sum = model.blocks.find((block) => block.label === "sum");

    expect(sum?.changedBytes).toEqual([
      { address: hex(0x7fffffffe268n), before: "00", after: "0a" },
    ]);
    expect(model.changeMarks).toHaveLength(1);
    expect(model.changeMarks[0].address).toBe(hex(0x7fffffffe268n));
    expect(model.changedCount).toBe(1);
  });

  it("still renders real frames and unknown memory when DWARF is absent", () => {
    const snapshot = makeSnapshot({ variables: [], variables_available: false });
    const model = buildStackMap(snapshot);

    expect(model.blocks.some((block) => block.kind === "variable")).toBe(false);
    expect(model.frames).toHaveLength(2);
    expect(model.frames[0].unknownRanges.length).toBeGreaterThan(0);
    expect(model.blocks.some((block) => block.kind === "saved-rbp")).toBe(true);
    expect(model.blocks.every((block) => block.kind !== "variable")).toBe(true);
  });

  it("reports variables outside the window instead of drawing a fake block", () => {
    const snapshot = makeSnapshot();
    const outside = variable({
      name: "heap_ptr",
      type: "char *",
      kind: "pointer",
      address: "0x000055555555a000",
      value: "0x000055555555b000",
      size_bytes: 8,
    });
    const model = buildStackMap({ ...snapshot, variables: [...snapshot.variables, outside] });

    expect(model.unplacedVariables.map((node) => node.name)).toContain("heap_ptr");
    expect(model.blocks.some((block) => block.label === "heap_ptr")).toBe(false);
  });
});

describe("pointer links", () => {
  it("resolves a pointer only to the exact address of a known block", () => {
    const model = buildStackMap(makeSnapshot());
    const link = model.pointerLinks.find((entry) => entry.variableName === "p");
    const target = model.blocks.find((block) => block.label === "a");

    expect(link?.state).toBe("resolved");
    expect(link?.targetAddress).toBe(hex(0x7fffffffe290n));
    expect(link?.targetBlockId).toBe(target?.id);
  });

  it("shows NULL pointers as NULL and never links them", () => {
    const snapshot = makeSnapshot();
    const nullPointer = variable({
      name: "n",
      type: "int *",
      kind: "pointer",
      address: hex(0x7fffffffe298n),
      value: "0x0000000000000000",
      size_bytes: 8,
      pointer_target: "0x0000000000000000",
      target_readable: false,
    });
    const model = buildStackMap({ ...snapshot, variables: [nullPointer] });

    expect(model.pointerLinks).toHaveLength(1);
    expect(model.pointerLinks[0].state).toBe("null");
    expect(model.pointerLinks[0].targetBlockId).toBeNull();
  });

  it("marks a target inside the window but outside any known block as unresolved", () => {
    const snapshot = makeSnapshot();
    const dangling = variable({
      name: "d",
      type: "int *",
      kind: "pointer",
      address: hex(0x7fffffffe298n),
      value: hex(0x7fffffffe2d0n),
      size_bytes: 8,
      pointer_target: hex(0x7fffffffe2d0n),
      target_readable: true,
    });
    const model = buildStackMap({ ...snapshot, variables: [dangling] });
    const link = model.pointerLinks.find((entry) => entry.variableName === "d");

    expect(link?.state).toBe("unresolved");
    expect(link?.targetKind).toBe("unknown");
    expect(link?.targetBlockId).toBeNull();
  });

  it("marks a target outside the stack window as outside-window", () => {
    const snapshot = makeSnapshot();
    const heap = variable({
      name: "h",
      type: "int *",
      kind: "pointer",
      address: hex(0x7fffffffe298n),
      value: "0x000055555555a000",
      size_bytes: 8,
      pointer_target: "0x000055555555a000",
      target_readable: true,
      target_bytes: "2a000000",
    });
    const model = buildStackMap({ ...snapshot, variables: [heap] });
    const link = model.pointerLinks.find((entry) => entry.variableName === "h");

    expect(link?.state).toBe("outside-window");
    expect(link?.targetBlockId).toBeNull();
    expect(link?.targetBytes).toBe("2a000000");
  });
});

describe("inferVariableSize", () => {
  it("uses the ABI only for primitive and array types", () => {
    expect(inferVariableSize("int")).toEqual({ size: 4, source: "abi" });
    expect(inferVariableSize("unsigned long")).toEqual({ size: 8, source: "abi" });
    expect(inferVariableSize("char *")).toEqual({ size: 8, source: "abi" });
    expect(inferVariableSize("int [3]")).toEqual({ size: 12, source: "abi" });
    expect(inferVariableSize("int *[2]")).toEqual({ size: 16, source: "abi" });
    expect(inferVariableSize("struct Point")).toEqual({ size: null, source: "unknown" });
    expect(inferVariableSize("char []")).toEqual({ size: null, source: "unknown" });
  });

  it("prefers the backend's DWARF sizeof and rejects nonsense values", () => {
    const node = variable({ type: "struct Point", size_bytes: 8 });
    expect(resolveVariableSize(node)).toEqual({ size: 8, source: "dwarf" });
    const invalid = variable({ type: "int", size_bytes: 0 });
    expect(resolveVariableSize(invalid)).toEqual({ size: 4, source: "abi" });
  });
});

describe("readSnapshotBytes", () => {
  it("reads real bytes across row boundaries and reports unknown bytes", () => {
    const snapshot = makeSnapshot();
    const bytes = readSnapshotBytes(snapshot, hex(0x7fffffffe278n), 16);

    expect(bytes.slice(0, 8)).toEqual([
      "7d",
      "11",
      "40",
      "00",
      "00",
      "00",
      "00",
      "00",
    ]);
    expect(bytes).toHaveLength(16);
    const missing = readSnapshotBytes(snapshot, "0x0000000000000001", 4);
    expect(missing).toEqual([null, null, null, null]);
  });
});
