import { describe, expect, it } from "vitest";

import { formatAddress } from "./address";
import {
  STACK_MAP_MAX_PX_PER_BYTE,
  STACK_MAP_MIN_PX_PER_BYTE,
  STACK_MAP_PX_PER_BYTE,
  STACK_MAP_MAX_POINTER_LANES,
  STACK_MAP_POINTER_LANE,
  addressTop,
  assignPointerLanes,
  buildRulerTicks,
  groupMemoryChangesByAddress,
  layoutChangeGroups,
  pointerLaneWidth,
  buildStackMap,
  fitFramePxPerByte,
  fitStackPxPerByte,
  inferVariableSize,
  layoutGutterAnnotations,
  readSnapshotBytes,
  resolveVariableSize,
  zoomPercent,
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

describe("variable frame ownership (V1.3)", () => {
  it("marks ownership verified when the frame_level claim agrees with the address range", () => {
    const model = buildStackMap(makeSnapshot());

    // Fixture: x/y/sum claim level 0 (add_numbers), a/b/p claim level 1 (main);
    // every address provably sits inside the claimed frame's byte range.
    expect(model.variableAssignments.map((entry) => entry.state)).toEqual([
      "verified",
      "verified",
      "verified",
      "verified",
      "verified",
      "verified",
    ]);
    expect(model.variableAssignments.every((e) => e.reason === "level-and-address-agree")).toBe(
      true,
    );
    expect(model.unverifiedCount).toBe(0);
    // Frame variable lists only assert verified ownership.
    expect(model.frames[0].variables.map((node) => node.name)).toEqual(["x", "y", "sum"]);
    expect(model.frames[1].variables.map((node) => node.name)).toEqual(["p", "a", "b"]);
  });

  it("never force-attaches a variable whose claimed level contradicts the address", () => {
    const snapshot = makeSnapshot();
    // `a` lives in main's locals area (0x...e290, inside frame 1) but now
    // claims to belong to frame 0.
    const a = snapshot.variables.find((node) => node.name === "a") as VariableNode;
    const model = buildStackMap({
      ...snapshot,
      variables: snapshot.variables.map((node) =>
        node.name === "a" ? { ...node, frame_level: 0 } : node,
      ),
    });
    void a;

    const entry = model.variableAssignments.find((e) => e.variableName === "a");
    expect(entry?.state).toBe("conflict");
    expect(entry?.reason).toBe("address-in-other-frame");
    expect(entry?.claimedFrameLevel).toBe(0);
    expect(entry?.geometricFrameLevel).toBe(1);
    // Not in any frame's variable list: neither the claimed one nor the one
    // whose byte range contains it.
    expect(model.frames[0].variables.some((node) => node.name === "a")).toBe(false);
    expect(model.frames[1].variables.some((node) => node.name === "a")).toBe(false);
    // Still drawn at its true address inside the geometrically containing frame.
    const frame1 = model.frames[1];
    const block = frame1.blocks.find(
      (candidate) => candidate.kind === "variable" && candidate.label === "a",
    );
    expect(block?.start).toBe(hex(0x7fffffffe290n));
    expect(block?.assignment).toBe("conflict");
    expect(model.unverifiedCount).toBe(1);
  });

  it("reports a conflict when the claimed frame is visible but the address lies outside it", () => {
    const snapshot = makeSnapshot();
    const model = buildStackMap({
      ...snapshot,
      variables: [
        variable({
          name: "ghost",
          type: "long",
          size_bytes: 8,
          address: hex(0x7fffffffe2b8n), // above main's frame end (0x...e2b0)
          value: "0",
          frame_level: 1,
        }),
      ],
    });

    const entry = model.variableAssignments.find((e) => e.variableName === "ghost");
    expect(entry?.state).toBe("conflict");
    expect(entry?.reason).toBe("address-outside-claimed-frame");
    expect(entry?.geometricFrameLevel).toBeNull();
    // Drawn standalone at its true address, never inside a frame.
    const standalone = model.unframedBlocks.find((block) => block.label === "ghost");
    expect(standalone?.start).toBe(hex(0x7fffffffe2b8n));
    expect(standalone?.assignment).toBe("conflict");
    expect(model.frames.every((frame) => !frame.variables.some((n) => n.name === "ghost"))).toBe(
      true,
    );
  });

  it("stays unresolved instead of guessing when the claimed frame is not drawn", () => {
    const snapshot = makeSnapshot();
    const model = buildStackMap({
      ...snapshot,
      variables: [
        variable({
          name: "far",
          type: "int",
          size_bytes: 4,
          address: hex(0x7fffffffe26cn), // inside add_numbers' frame
          value: "1",
          frame_level: 5, // level 5 is in the GDB chain but not provable here
        }),
      ],
    });

    const entry = model.variableAssignments.find((e) => e.variableName === "far");
    expect(entry?.state).toBe("unresolved");
    expect(entry?.reason).toBe("claimed-frame-not-visible");
    // The block is still rendered at the real address, flagged as unresolved.
    const block = model.frames[0].blocks.find(
      (candidate) => candidate.kind === "variable" && candidate.label === "far",
    );
    expect(block?.assignment).toBe("unresolved");
    expect(model.unverifiedCount).toBe(1);
  });

  it("keeps variables outside every drawn frame visible with unresolved ownership", () => {
    const snapshot = makeSnapshot();
    const model = buildStackMap({
      ...snapshot,
      variables: [
        variable({
          name: "orphan",
          type: "int",
          size_bytes: 4,
          address: hex(0x7fffffffe2c4n), // above all verified frame extents
          value: "7",
          frame_level: 2, // level 2 exists in the call chain, outside the window
        }),
      ],
    });

    const entry = model.variableAssignments.find((e) => e.variableName === "orphan");
    expect(entry?.state).toBe("unresolved");
    // Neither the claimed frame nor any frame range covers this address, so
    // there is no evidence at all to attribute ownership from.
    expect(entry?.reason).toBe("outside-verified-frames");
    const standalone = model.unframedBlocks.find((block) => block.label === "orphan");
    expect(standalone?.start).toBe(hex(0x7fffffffe2c4n));
    expect(standalone?.top).toBe(
      Number(WINDOW_END - 0x7fffffffe2c8n) * STACK_MAP_PX_PER_BYTE,
    );
  });
});

describe("stack map zoom (V1.3)", () => {
  it("scales the whole drawing with one shared px/byte while addresses stay exact", () => {
    const snapshot = makeSnapshot();
    const actual = buildStackMap(snapshot);
    const zoomed = buildStackMap(snapshot, 2.5);
    const span = Number(WINDOW_END - WINDOW_START);

    expect(zoomed.pxPerByte).toBe(2.5);
    expect(zoomed.contentHeight).toBe(span * 2.5);
    // Same block set, same real extents.
    expect(zoomed.blocks.map((b) => `${b.start}-${b.end}`)).toEqual(
      actual.blocks.map((b) => `${b.start}-${b.end}`),
    );
    const zoomedX = zoomed.blocks.find((b) => b.label === "x");
    const actualX = actual.blocks.find((b) => b.label === "x");
    expect(zoomedX?.height).toBe(4 * 2.5);
    expect(actualX?.height).toBe(4 * STACK_MAP_PX_PER_BYTE);
    // Same coordinate system everywhere: the block's top edge sits exactly at
    // addressTop() of its real end address, inside its frame.
    const zoomedFrame0 = zoomed.frames[0];
    const zoomedXEnd = zoomedX?.end ?? null;
    expect(addressTop(zoomed, zoomedXEnd)! - zoomedFrame0.top).toBe(zoomedX?.top);
    // Marker and ruler share the transform.
    expect(zoomed.rspTop).toBe(Number(WINDOW_END - RSP) * 2.5);
    // Ticks sit on byte-row edges; the lowest may peek one scale below.
    expect(
      zoomed.rulerTicks.every((tick) => tick.top <= zoomed.contentHeight + zoomed.pxPerByte),
    ).toBe(true);
  });

  it("clamps px/byte so the drawing never collapses or explodes", () => {
    const snapshot = makeSnapshot();
    expect(buildStackMap(snapshot, 5000).pxPerByte).toBe(STACK_MAP_MAX_PX_PER_BYTE);
    expect(buildStackMap(snapshot, 0.001).pxPerByte).toBe(STACK_MAP_MIN_PX_PER_BYTE);
    expect(buildStackMap(snapshot, Number.NaN).pxPerByte).toBe(STACK_MAP_PX_PER_BYTE);
  });

  it("derives fit scales from the viewport without touching addresses", () => {
    const snapshot = makeSnapshot();
    const span = Number(WINDOW_END - WINDOW_START);
    const frameBytes = 40; // add_numbers frame: rsp..rbp+16

    const stackScale = fitStackPxPerByte(800, span);
    expect(stackScale).toBeCloseTo((800 - 24) / span, 5);
    const frameScale = fitFramePxPerByte(800, frameBytes);
    expect(frameScale).toBeCloseTo((800 - 48) / frameBytes, 5);

    const model = buildStackMap(snapshot, stackScale);
    expect(model.contentHeight).toBeLessThanOrEqual(800);
    // The block for `x` keeps its real 4-byte extent.
    const x = model.blocks.find((b) => b.label === "x");
    expect(Number(BigInt(x!.end) - BigInt(x!.start))).toBe(4);

    expect(fitStackPxPerByte(0, span)).toBe(STACK_MAP_PX_PER_BYTE);
    expect(fitFramePxPerByte(800, 0)).toBe(STACK_MAP_PX_PER_BYTE);
  });

  it("reports zoom percentage relative to the actual teaching scale", () => {
    expect(zoomPercent(STACK_MAP_PX_PER_BYTE)).toBe(100);
    expect(zoomPercent(5)).toBe(50);
    expect(zoomPercent(20)).toBe(200);
  });
});

describe("gutter annotations for micro blocks (V1.3)", () => {
  const micro = (id: string, top: number, height: number) => ({
    id,
    kind: "variable" as const,
    label: id,
    top,
    height,
    assignment: "verified" as const,
  });

  it("annotates blocks below the micro threshold with non-overlapping chips", () => {
    // char (10 px) directly above short (20 px) — anchors are 15 px apart.
    const chips = layoutGutterAnnotations(
      [micro("c", 0, 10), micro("s", 10, 20), micro("big", 30, 40)],
      { minTop: 0 },
    );

    expect(chips.map((chip) => chip.label)).toEqual(["c", "s"]);
    // First chip centres on its anchor; the second is pushed below the first.
    expect(chips[0].chipTop).toBe(0);
    expect(chips[1].chipTop).toBeGreaterThanOrEqual(chips[0].chipTop + 18);
    // Leader anchors still point at the real blocks.
    expect(chips[0].anchorTop).toBe(5);
    expect(chips[1].anchorTop).toBe(20);
  });

  it("keeps chips outside the reserved header zone when asked", () => {
    const chips = layoutGutterAnnotations([micro("c", 0, 10)], { minTop: 88 });
    expect(chips[0].chipTop).toBe(88);
    expect(chips[0].anchorTop).toBe(5);
  });
});

describe("leaf-function red-zone locals (V1.3)", () => {
  it("verifies locals below RSP when the claimed frame provably owns the region", () => {
    const snapshot = makeSnapshot();
    // Leaf functions (gcc -O0 keeps RSP unchanged) place locals below RSP.
    // 0x...e258 sits below the add_numbers frame start (RSP) but above the
    // window bottom, and frame 0 is drawn: the evidence is consistent.
    const model = buildStackMap({
      ...snapshot,
      variables: [
        variable({
          name: "red",
          type: "int",
          size_bytes: 4,
          address: hex(0x7fffffffe258n), // below RSP=e260, inside the window
          value: "3",
          frame_level: 0,
        }),
      ],
    });

    const entry = model.variableAssignments.find((e) => e.variableName === "red");
    expect(entry?.state).toBe("verified");
    expect(entry?.reason).toBe("within-frame-region");
    expect(entry?.geometricFrameLevel).toBe(0);
    // Counted as a real variable of frame 0.
    expect(model.frames[0].variables.some((node) => node.name === "red")).toBe(true);
  });

  it("still reports a conflict when the address is below every drawn frame region", () => {
    const snapshot = makeSnapshot();
    const model = buildStackMap({
      ...snapshot,
      stack: {
        ...snapshot.stack,
        // Push the window bottom down so the address falls outside the
        // plausible region [windowStart, frame0 base+16].
        range_start: hex(0x7fffffffe100n),
      },
      variables: [
        variable({
          name: "deep",
          type: "int",
          size_bytes: 4,
          address: hex(0x7fffffffe150n),
          value: "1",
          frame_level: 0,
        }),
      ],
    });
    const entry = model.variableAssignments.find((e) => e.variableName === "deep");
    // 0x110 bytes below RSP is past the 128-byte red zone: a live level-0
    // local cannot legally sit there, so this is a positive contradiction.
    expect(entry?.state).toBe("conflict");
    expect(entry?.reason).toBe("address-outside-claimed-frame");
  });
});

describe("pointer lane assignment (V1.3.1)", () => {
  const link = (name: string) => ({ id: `ptr:${name}`, laneIndex: 99, name });

  it("assigns dense unique lanes AFTER filtering, for 1/4/5/10 visible links", () => {
    for (const count of [1, 4, 5, 10]) {
      const links = Array.from({ length: count }, (_, index) => link(`v${index}`));
      const routed = assignPointerLanes(links, (entry) => entry.laneIndex);
      // order key irrelevant here; what matters: dense 0..n-1, unique, count preserved
      expect(routed).toHaveLength(count);
      const lanes = routed.map((entry) => entry.laneIndex).sort((a, b) => a - b);
      expect(lanes).toEqual(Array.from({ length: count }, (_, index) => index));
      expect(new Set(lanes).size).toBe(count);
    }
  });

  it("orders lanes by the given geometry key (exit Y)", () => {
    const links = [
      { id: "a", laneIndex: 7, fromTop: 300 },
      { id: "b", laneIndex: 7, fromTop: 100 },
      { id: "c", laneIndex: 7, fromTop: 200 },
    ];
    const routed = assignPointerLanes(links, (entry) => entry.fromTop);
    expect(routed.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(routed.map((entry) => entry.laneIndex)).toEqual([0, 1, 2]);
  });

  it("grows the routing area linearly with the visible count and caps lanes", () => {
    expect(pointerLaneWidth(0)).toBe(12);
    expect(pointerLaneWidth(1)).toBe(1 * STACK_MAP_POINTER_LANE + 20);
    expect(pointerLaneWidth(4)).toBe(4 * STACK_MAP_POINTER_LANE + 20);
    expect(pointerLaneWidth(10)).toBe(10 * STACK_MAP_POINTER_LANE + 20);
    // Beyond the cap every drawn arrow still has its own X: lanes never share.
    expect(pointerLaneWidth(30)).toBe(STACK_MAP_MAX_POINTER_LANES * STACK_MAP_POINTER_LANE + 20);
  });
});

describe("adaptive ruler ticks (V1.3.1)", () => {
  const START = 0x7fffffffe200n;
  const END = 0x7fffffffe300n; // 256 bytes

  it("presentation mode: major ticks only, spaced >= 56 px, addresses aligned", () => {
    const ticks = buildRulerTicks(START, END, 10, "presentation");
    // 256 bytes at 10 px/byte: a 32-byte step = 320 px >= 56, so no minors.
    expect(ticks.every((tick) => tick.major)).toBe(true);
    expect(ticks.length).toBeLessThanOrEqual(256 / 32 + 2);
    const tops = ticks.map((tick) => tick.top).sort((a, b) => a - b);
    for (let index = 1; index < tops.length; index += 1) {
      expect(tops[index] - tops[index - 1]).toBeGreaterThanOrEqual(56);
    }
    // Address labels sit exactly at their byte row (same addressTop transform).
    const tick = ticks[0];
    expect(tick.top).toBe(Number(END - BigInt(tick.address)) * 10 + 10);
  });

  it("developer mode: denser majors and minor ticks when they fit", () => {
    const ticks = buildRulerTicks(START, END, 10, "developer");
    const majors = ticks.filter((tick) => tick.major);
    const minors = ticks.filter((tick) => !tick.major);
    expect(majors.length).toBeGreaterThanOrEqual(256 / 32);
    // 16-byte minors at 10 px/byte = 160 px apart, comfortably readable.
    expect(minors.length).toBeGreaterThan(0);
  });

  it("scales the step with zoom so labels never crowd", () => {
    // Zoomed out: 1 px/byte -> the 32-byte step is only 32 px, so the ruler
    // must move to a larger step.
    const ticks = buildRulerTicks(START, END, 1, "presentation");
    const tops = ticks.map((tick) => tick.top).sort((a, b) => a - b);
    for (let index = 1; index < tops.length; index += 1) {
      expect(tops[index] - tops[index - 1]).toBeGreaterThanOrEqual(56);
    }
  });
});

describe("memory change grouping (V1.3.2)", () => {
  const change = (address: string, before = "00", after = "01") => ({ address, before, after });

  it("merges contiguous addresses and keeps every before/after", () => {
    const groups = groupMemoryChangesByAddress([
      change("0x0000000000001000"),
      change("0x0000000000001001", "00", "02"),
      change("0x0000000000001002", "00", "03"),
      change("0x0000000000001008", "00", "04"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ start: "0x0000000000001000", end: "0x0000000000001003", count: 3 });
    expect(groups[1]).toMatchObject({ start: "0x0000000000001008", end: "0x0000000000001009", count: 1 });
    // Original per-byte evidence survives the merge.
    expect(groups[0].changes.map((c) => c.after)).toEqual(["01", "02", "03"]);
    expect(groups[1].changes[0].after).toBe("04");
  });

  it("tolerates unsorted input, duplicates-free single bytes and empty input", () => {
    const unsorted = groupMemoryChangesByAddress([
      change("0x0000000000002000"),
      change("0x0000000000001000"),
    ]);
    expect(unsorted.map((g) => g.start)).toEqual(["0x0000000000001000", "0x0000000000002000"]);
    expect(groupMemoryChangesByAddress([])).toEqual([]);
    expect(groupMemoryChangesByAddress([change("0x0000000000001000")])).toHaveLength(1);
  });

  it("never fabricates entries: total bytes out == total bytes in", () => {
    const input = Array.from({ length: 10 }, (_, i) =>
      change(`0x000000000000${(0x3000 + i * 3).toString(16).padStart(4, "0")}`),
    );
    const groups = groupMemoryChangesByAddress(input);
    expect(groups.reduce((total, g) => total + g.count, 0)).toBe(10);
  });

  it("lays out merged runs at exact byte rows (8 contiguous -> one mark)", () => {
    const changes = Array.from({ length: 8 }, (_, i) =>
      change(`0x00000000000019${(0x10 + i).toString(16)}`),
    ); // 0x1910..0x1917, contiguous
    const groups = groupMemoryChangesByAddress(changes);
    expect(groups).toHaveLength(1);
    const layouts = layoutChangeGroups(groups, "0x0000000000001a00", 10);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].height).toBe(80); // 8 bytes x 10 px
    // top = (0x1a00 - 0x1918) * 10
    expect(layouts[0].top).toBe((0x1a00 - 0x1918) * 10);
  });

  it("keeps scattered bytes as independent marks", () => {
    const changes = Array.from({ length: 8 }, (_, i) =>
      change(`0x00000000000019${(i * 2).toString(16).padStart(2, "0")}`),
    ); // stride 2 -> never contiguous
    const groups = groupMemoryChangesByAddress(changes);
    expect(groups).toHaveLength(8);
    expect(layoutChangeGroups(groups, "0x0000000000001a00", 10)).toHaveLength(8);
  });
});

describe("diff rendering does not move memory (V1.3.2)", () => {
  it("changed bytes never alter block geometry or the address layout", () => {
    const withDiff = makeSnapshot();
    const withoutDiff: Snapshot = {
      ...withDiff,
      diff: { ...withDiff.diff, changed_bytes: [], changed_registers: [] },
    };

    const a = buildStackMap(withDiff);
    const b = buildStackMap(withoutDiff);
    expect(a.contentHeight).toBe(b.contentHeight);
    expect(a.blocks.map((block) => [block.id, block.top, block.height])).toEqual(
      b.blocks.map((block) => [block.id, block.top, block.height]),
    );
    // The diff only adds change evidence, not geometry.
    expect(a.changeMarks.length).toBeGreaterThan(0);
    expect(b.changeMarks).toHaveLength(0);
  });
});
