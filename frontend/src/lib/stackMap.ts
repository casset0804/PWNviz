/**
 * Graphical stack-map layout engine.
 *
 * Every number produced here is derived from the snapshot's real GDB data:
 *
 *  - byte extents and addresses come from `snapshot.stack.rows` /
 *    DWARF `VariableNode.address` (+ `size_bytes` from GDB `sizeof`);
 *  - frame boundaries come from cross-checking the frame-pointer chain against
 *    the GDB unwinder's caller PC (`snapshot.frames[level + 1].address`). A
 *    frame is only drawn as a verified frame when the return-address slot in
 *    memory really contains that PC. We never assume `rbp - rsp` is the locals
 *    area and we never invent a variable address;
 *  - when the frame pointer is unavailable/optimised away the current function
 *    is still drawn from RSP upward, but marked "boundary unknown";
 *  - changed bytes come from `snapshot.diff.changed_bytes`.
 *
 * The module is pure (snapshot in, immutable model out) and has no React or DOM
 * dependency, so the layout rules are unit-testable.
 */

import {
  formatAddress,
  normalizeAddress,
  parseAddress,
} from "./address";
import type {
  Frame,
  MemoryChange,
  Snapshot,
  StackRow,
  VariableNode,
} from "../types/debug";

/** Vertical pixels per real stack byte. Kept in one place so offsets stay exact. */
export const STACK_MAP_PX_PER_BYTE = 10;
/** Width reserved on the right of the map for pointer-arrow routing. */
export const STACK_MAP_POINTER_LANE = 76;
/** The address ruler's width. */
export const STACK_MAP_RULER_WIDTH = 164;
/** The frame-label column that sits between the ruler and the memory blocks. */
export const STACK_MAP_FRAME_LABEL_WIDTH = 184;
/** Safety cap: a snapshot never needs more than a handful of drawn frames. */
export const MAX_RENDERED_FRAMES = 6;
/** Ruler label interval (bytes); ticks are drawn every 8 bytes. */
const RULER_LABEL_STEP = 16;

export type StackMapBlockKind =
  | "variable"
  | "saved-rbp"
  | "return-address"
  | "unknown"
  | "unreadable"
  | "below-rsp"
  | "above-frames";

export type VariableSizeSource = "dwarf" | "abi" | "unknown";

export interface StackMapBlock {
  id: string;
  kind: StackMapBlockKind;
  frameLevel: number | null;
  /** Inclusive start and exclusive end of the real byte range. */
  start: string;
  end: string;
  sizeBytes: number | null;
  sizeSource: VariableSizeSource;
  label: string;
  type: string | null;
  value: string | null;
  variable: VariableNode | null;
  address: string;
  changedBytes: MemoryChange[];
  readable: boolean;
  /** True when the DWARF size extends past the visible stack window. */
  clipped: boolean;
  /** Layout inside the frame (top from the frame's own top edge). */
  top: number;
  height: number;
  /** True for a variable whose DWARF size was not measurable. */
  pin: boolean;
  overlaps: boolean;
}

export interface StackFrameExtent {
  level: number;
  function: string | null;
  file: string | null;
  line: number | null;
  start: string;
  end: string;
  base: string | null;
  verified: boolean;
  returnAddress: string | null;
  returnAddressBlockId: string | null;
  savedRbp: string | null;
  savedRbpBlockId: string | null;
  blocks: StackMapBlock[];
  variables: VariableNode[];
  registerVariables: VariableNode[];
  unknownRanges: Array<{ start: string; end: string; readable: boolean }>;
  top: number;
  height: number;
}

export interface StackCallChainEntry {
  level: number;
  function: string | null;
  file: string | null;
  line: number | null;
  address: string | null;
  /** True when this frame's memory extent was verified in the visible window. */
  memoryVisible: boolean;
}

export type PointerLinkState =
  | "resolved"
  | "unresolved"
  | "null"
  | "unreadable"
  | "outside-window";

export interface PointerLink {
  id: string;
  variableName: string;
  fromBlockId: string;
  fromAddress: string;
  targetAddress: string;
  targetBlockId: string | null;
  targetKind: "variable" | "saved-rbp" | "return-address" | "unknown" | "none";
  state: PointerLinkState;
  targetReadable: boolean | null;
  targetBytes: string | null;
  targetString: string | null;
  laneIndex: number;
}

export interface StackChangeMark {
  address: string;
  before: string | null;
  after: string | null;
  /** Offset from the top of the canvas content in pixels. */
  top: number;
}

export interface StackMapModel {
  available: boolean;
  reason:
    | "no-snapshot"
    | "no-window"
    | "no-stack-pointer"
    | "ready";
  windowStart: string | null;
  windowEnd: string | null;
  contentHeight: number;
  pxPerByte: number;
  rsp: string | null;
  rbp: string | null;
  rip: string | null;
  rspTop: number | null;
  rbpTop: number | null;
  frames: StackFrameExtent[];
  callChain: StackCallChainEntry[];
  blocks: StackMapBlock[];
  pointerLinks: PointerLink[];
  changeMarks: StackChangeMark[];
  belowRsp: StackMapBlock | null;
  aboveFrames: StackMapBlock | null;
  unplacedVariables: VariableNode[];
  registerVariables: VariableNode[];
  changedCount: number;
  unreadableCount: number;
  rulerTicks: Array<{ address: string; top: number; major: boolean }>;
  firstFrameLevel: number | null;
}

const EMPTY_MODEL: StackMapModel = {
  available: false,
  reason: "no-snapshot",
  windowStart: null,
  windowEnd: null,
  contentHeight: 0,
  pxPerByte: STACK_MAP_PX_PER_BYTE,
  rsp: null,
  rbp: null,
  rip: null,
  rspTop: null,
  rbpTop: null,
  frames: [],
  callChain: [],
  blocks: [],
  pointerLinks: [],
  changeMarks: [],
  belowRsp: null,
  aboveFrames: null,
  unplacedVariables: [],
  registerVariables: [],
  changedCount: 0,
  unreadableCount: 0,
  rulerTicks: [],
  firstFrameLevel: null,
};

// ---------------------------------------------------------------------------
// Size inference (fallback only; the backend measures DWARF sizeof).
// ---------------------------------------------------------------------------

const PRIMITIVE_SIZES: Record<string, number> = {
  _bool: 1,
  bool: 1,
  char: 1,
  signedchar: 1,
  unsignedchar: 1,
  short: 2,
  signedshort: 2,
  unsignedshort: 2,
  int: 4,
  signedint: 4,
  unsignedint: 4,
  unsigned: 4,
  signed: 4,
  float: 4,
  long: 8,
  signedlong: 8,
  unsignedlong: 8,
  longlong: 8,
  signedlonglong: 8,
  unsignedlonglong: 8,
  double: 8,
  longdouble: 16,
  __int128: 16,
  unsigned__int128: 16,
  size_t: 8,
  ssize_t: 8,
  uintptr_t: 8,
  intptr_t: 8,
  ptrdiff_t: 8,
  wchar_t: 4,
  char16_t: 2,
  char32_t: 4,
};

function normalizedType(type: string): string {
  return type
    .replace(/\b(const|volatile|restrict|static|register|_Atomic)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactType(type: string): string {
  return normalizedType(type).replace(/\s+/g, " ");
}

function primitiveKey(type: string): string {
  return compactType(type).replace(/\s+/g, "").toLowerCase();
}

/**
 * Best-effort ABI size for a C type string.
 *
 * This is only used when the backend did not report `size_bytes` (older
 * snapshot). Primitive sizes are fixed by the x86-64 System V ABI; arrays are
 * multiplied out; structs/unions/unknown types deliberately return `null`
 * instead of a guess. The caller marks the block as "address only" then.
 */
export function inferVariableSize(
  type: string,
  pointerBits = 64,
): { size: number | null; source: VariableSizeSource } {
  if (!type || !type.trim()) return { size: null, source: "unknown" };
  const cleaned = normalizedType(type);
  const pointerSize = Math.max(1, Math.round(pointerBits / 8));

  // Arrays are parsed before pointers so `int *[3]` is 3 pointers.
  const arrayMatch = cleaned.match(/^(.*)\[(\d*)\]$/);
  if (arrayMatch) {
    const element = arrayMatch[1].trim();
    const count = arrayMatch[2] ? Number(arrayMatch[2]) : null;
    if (!element || count === null || !Number.isFinite(count) || count <= 0) {
      return { size: null, source: "unknown" };
    }
    const elementSize = inferVariableSize(element, pointerBits);
    if (elementSize.size === null) return { size: null, source: "unknown" };
    return { size: elementSize.size * count, source: elementSize.source };
  }

  if (cleaned.includes("*")) {
    // Any pointer, including a function pointer, is one pointer wide.
    return { size: pointerSize, source: "abi" };
  }

  const key = primitiveKey(cleaned);
  if (key in PRIMITIVE_SIZES) {
    return { size: PRIMITIVE_SIZES[key], source: "abi" };
  }
  if (key === "void") return { size: null, source: "unknown" };
  // `struct X`, `union X`, `enum X`: never guess.
  return { size: null, source: "unknown" };
}

export function resolveVariableSize(
  node: VariableNode,
  pointerBits = 64,
): { size: number | null; source: VariableSizeSource } {
  const measured = node.size_bytes;
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
    return { size: Math.floor(measured), source: "dwarf" };
  }
  return inferVariableSize(node.type, pointerBits);
}

// ---------------------------------------------------------------------------
// Raw memory helpers
// ---------------------------------------------------------------------------

interface ByteMap {
  bytes: Map<bigint, string | null>;
}

function buildByteMap(rows: StackRow[], windowStart: bigint, windowEnd: bigint): ByteMap {
  const bytes = new Map<bigint, string | null>();
  for (const row of rows) {
    const start = parseAddress(row.address);
    if (start === null) continue;
    for (let index = 0; index < row.bytes.length; index += 1) {
      const address = start + BigInt(index);
      if (address < windowStart || address >= windowEnd) continue;
      bytes.set(address, row.bytes[index] ?? null);
    }
  }
  return { bytes };
}

function readQword(map: ByteMap, address: bigint): string | null {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    const byte = map.bytes.get(address + BigInt(index));
    if (byte === undefined || byte === null) return null;
    value |= BigInt(Number.parseInt(byte, 16)) << BigInt(index * 8);
  }
  return formatAddress(value);
}

function rangeReadable(map: ByteMap, start: bigint, end: bigint): boolean {
  for (let address = start; address < end; address += 1n) {
    if (!map.bytes.has(address)) return false;
    if (map.bytes.get(address) === null) return false;
  }
  return true;
}

/** Read a bounded range of real bytes from a snapshot (for detail panels). */
export function readSnapshotBytes(
  snapshot: Snapshot | null,
  address: string | null,
  count = 32,
): Array<string | null> {
  if (!snapshot || !address) return [];
  const target = parseAddress(address);
  if (target === null) return [];
  const wanted = Math.max(0, Math.min(count, 256));
  const result: Array<string | null> = [];
  for (let index = 0; index < wanted; index += 1) {
    const byteAddress = target + BigInt(index);
    let found: string | null | undefined;
    for (const row of snapshot.stack.rows) {
      const rowStart = parseAddress(row.address);
      if (rowStart === null) continue;
      const offset = byteAddress - rowStart;
      if (offset >= 0n && offset < BigInt(row.bytes.length)) {
        found = row.bytes[Number(offset)] ?? null;
        break;
      }
    }
    result.push(found === undefined ? null : found);
  }
  return result;
}

function within(address: bigint, start: bigint, end: bigint): boolean {
  return address >= start && address < end;
}

function clamp(value: bigint, low: bigint, high: bigint): bigint {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

function yFor(address: bigint, windowEnd: bigint): number {
  return Number(windowEnd - address) * STACK_MAP_PX_PER_BYTE;
}

function sizeFor(start: bigint, end: bigint): number {
  return Number(end - start) * STACK_MAP_PX_PER_BYTE;
}

// ---------------------------------------------------------------------------
// Frame derivation
// ---------------------------------------------------------------------------

interface VerifiedFrame {
  level: number;
  base: bigint;
  start: bigint;
  end: bigint;
  savedRbp: string | null;
  savedRbpSlot: bigint | null;
  returnAddress: string | null;
  returnAddressSlot: bigint | null;
  verified: boolean;
}

interface FrameDerivation {
  verified: VerifiedFrame[];
  gdbFrames: Frame[];
}

/**
 * Walk the frame-pointer chain only while every step is corroborated by the
 * GDB unwinder's caller PC. The return-address slot is memory we just read;
 * if it does not equal the unwound caller PC we stop instead of drawing a
 * frame we cannot prove.
 */
function deriveVerifiedFrames(
  gdbFrames: Frame[],
  map: ByteMap,
  rsp: bigint | null,
  rbp: bigint | null,
  windowStart: bigint,
  windowEnd: bigint,
): FrameDerivation {
  const verified: VerifiedFrame[] = [];
  if (rsp === null || rbp === null) return { verified, gdbFrames };
  if (!within(rbp, windowStart, windowEnd)) return { verified, gdbFrames };
  if (rbp < rsp) return { verified, gdbFrames };

  let base = rbp;
  let low = rsp;
  for (let index = 0; index < gdbFrames.length; index += 1) {
    if (verified.length >= MAX_RENDERED_FRAMES) break;
    const caller = gdbFrames[index + 1] ?? null;
    const callerAddress = normalizeAddress(caller?.address ?? null);
    if (!caller || !callerAddress) break;
    if (base < low || base + 16n > windowEnd) break;
    const returnAddress = readQword(map, base + 8n);
    if (!returnAddress || returnAddress !== callerAddress) break;
    const savedRbp = readQword(map, base);
    verified.push({
      level: index,
      base,
      start: low,
      end: base + 16n,
      savedRbp,
      savedRbpSlot: base,
      returnAddress,
      returnAddressSlot: base + 8n,
      verified: true,
    });

    const savedBase = parseAddress(savedRbp);
    if (savedBase === null || savedBase === 0n) break;
    if (savedBase <= base) break;
    if (savedBase + 16n > windowEnd) break;
    // The chain must point at an aligned stack word; otherwise the saved value
    // is just ordinary memory that happens to look like an address.
    if (savedBase % 8n !== 0n) break;
    base = savedBase;
    low = verified[verified.length - 1].end;
  }
  return { verified, gdbFrames };
}

/**
 * Function-entry fallback.
 *
 * A `call` pushes the return address at the current RSP; the callee's frame
 * pointer is not established until `push rbp`/`mov rbp,rsp` have executed.
 * During those few instructions the RBP register still belongs to the caller.
 * This function only claims what memory proves:
 *
 *  - the return-address slot is the first qword in [RSP, RSP+0x18) whose value
 *    exactly equals the unwinder's caller PC;
 *  - the saved-RBP slot is accepted only when it is immediately below that
 *    return address and its qword exactly equals the current RBP register;
 *  - the caller frame is drawn only when the caller's own saved-RIP slot equals
 *    the next unwinder PC (frames[2]).
 *
 * If none of that holds, the caller gets an explicitly unbounded frame instead.
 */
function deriveEntryFrames(
  gdbFrames: Frame[],
  map: ByteMap,
  rsp: bigint | null,
  rbp: bigint | null,
  windowStart: bigint,
  windowEnd: bigint,
): VerifiedFrame[] {
  if (rsp === null || gdbFrames.length < 2) return [];
  if (!within(rsp, windowStart, windowEnd)) return [];
  const callerPc = normalizeAddress(gdbFrames[1]?.address ?? null);
  if (!callerPc) return [];

  let returnSlot: bigint | null = null;
  for (let offset = 0n; offset <= 0x18n; offset += 8n) {
    const slot = rsp + offset;
    if (slot + 8n > windowEnd) break;
    const value = readQword(map, slot);
    if (value === callerPc) {
      returnSlot = slot;
      break;
    }
  }
  if (returnSlot === null) return [];

  let savedRbpSlot: bigint | null = null;
  let savedRbpValue: string | null = null;
  if (returnSlot === rsp + 8n && rbp !== null) {
    const candidate = readQword(map, rsp);
    if (candidate && candidate === formatAddress(rbp)) {
      savedRbpSlot = rsp;
      savedRbpValue = candidate;
    }
  }

  const frames: VerifiedFrame[] = [
    {
      level: 0,
      base: 0n,
      start: rsp,
      end: returnSlot + 8n,
      savedRbp: savedRbpValue,
      savedRbpSlot,
      returnAddress: callerPc,
      returnAddressSlot: returnSlot,
      verified: false,
    },
  ];

  // The RBP register is still the caller's frame base in this state. Accept it
  // only when the caller's saved-RIP slot matches the next unwinder PC.
  const nextPc = normalizeAddress(gdbFrames[2]?.address ?? null);
  const calleeEnd = returnSlot + 8n;
  if (
    rbp !== null &&
    nextPc &&
    calleeEnd <= rbp &&
    rbp + 16n <= windowEnd
  ) {
    const callerReturn = readQword(map, rbp + 8n);
    if (callerReturn === nextPc) {
      frames.push({
        level: 1,
        base: rbp,
        start: calleeEnd,
        end: rbp + 16n,
        savedRbp: readQword(map, rbp),
        savedRbpSlot: rbp,
        returnAddress: callerReturn,
        returnAddressSlot: rbp + 8n,
        verified: true,
      });
    }
  }
  return frames;
}

interface VariablePlacement {
  node: VariableNode;
  start: bigint;
  end: bigint;
  size: number | null;
  source: VariableSizeSource;
  clipped: boolean;
}

function placeVariables(
  nodes: VariableNode[],
  windowStart: bigint,
  windowEnd: bigint,
  pointerBits: number,
): { placed: VariablePlacement[]; unplaced: VariableNode[] } {
  const placed: VariablePlacement[] = [];
  const unplaced: VariableNode[] = [];
  for (const node of nodes) {
    if (node.location_kind !== "memory" || !node.address) continue;
    const start = parseAddress(node.address);
    if (start === null) {
      unplaced.push(node);
      continue;
    }
    if (!within(start, windowStart, windowEnd)) {
      unplaced.push(node);
      continue;
    }
    const resolved = resolveVariableSize(node, pointerBits);
    if (resolved.size === null) {
      placed.push({
        node,
        start,
        end: start + 1n,
        size: null,
        source: "unknown",
        clipped: false,
      });
      continue;
    }
    const rawEnd = start + BigInt(resolved.size);
    const end = clamp(rawEnd, start + 1n, windowEnd);
    placed.push({
      node,
      start,
      end,
      size: resolved.size,
      source: resolved.source,
      clipped: rawEnd > windowEnd,
    });
  }
  placed.sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
  return { placed, unplaced };
}

function blockFromPlacement(
  placement: VariablePlacement,
  frameTopPx: number,
  windowEnd: bigint,
  changedByAddress: Map<string, MemoryChange>,
  map: ByteMap,
): StackMapBlock {
  const node = placement.node;
  const top = yFor(placement.end, windowEnd) - frameTopPx;
  const changedBytes: MemoryChange[] = [];
  for (const change of changedByAddress.values()) {
    const address = parseAddress(change.address);
    if (address !== null && within(address, placement.start, placement.end)) {
      changedBytes.push(change);
    }
  }
  return {
    id: `var:${node.name}:${frameTopPx}:${placement.start.toString(16)}`,
    kind: "variable",
    frameLevel: node.frame_level ?? 0,
    start: formatAddress(placement.start),
    end: formatAddress(placement.end),
    sizeBytes: placement.size,
    sizeSource: placement.source,
    label: node.name,
    type: node.type,
    value: node.value,
    variable: node,
    address: formatAddress(placement.start),
    changedBytes: changedBytes.sort((left, right) =>
      left.address < right.address ? -1 : left.address > right.address ? 1 : 0,
    ),
    readable: rangeReadable(map, placement.start, placement.end),
    clipped: placement.clipped,
    top,
    height: Math.max(1, sizeFor(placement.start, placement.end)),
    pin: placement.size === null,
    overlaps: false,
  };
}

/** Subtract known byte ranges from a frame and return the remaining gaps. */
function subtractRanges(
  start: bigint,
  end: bigint,
  ranges: Array<{ start: bigint; end: bigint }>,
): Array<{ start: bigint; end: bigint }> {
  const sorted = [...ranges]
    .filter((range) => range.end > start && range.start < end)
    .map((range) => ({ start: clamp(range.start, start, end), end: clamp(range.end, start, end) }))
    .sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
  const gaps: Array<{ start: bigint; end: bigint }> = [];
  let cursor = start;
  for (const range of sorted) {
    if (range.start > cursor) gaps.push({ start: cursor, end: range.start });
    if (range.end > cursor) cursor = range.end;
    if (cursor >= end) break;
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  return gaps;
}

function frameUnknownBlocks(
  frame: VerifiedFrame,
  frameTopPx: number,
  knownRanges: Array<{ start: bigint; end: bigint }>,
  map: ByteMap,
  windowEnd: bigint,
): { blocks: StackMapBlock[]; unknownRanges: StackFrameExtent["unknownRanges"] } {
  const blocks: StackMapBlock[] = [];
  const unknownRanges: StackFrameExtent["unknownRanges"] = [];
  const gaps = subtractRanges(frame.start, frame.end, knownRanges);
  for (const gap of gaps) {
    const size = gap.end - gap.start;
    const readable = rangeReadable(map, gap.start, gap.end);
    const id = `unknown:${frame.level}:${gap.start.toString(16)}`;
    blocks.push({
      id,
      kind: readable ? "unknown" : "unreadable",
      frameLevel: frame.level,
      start: formatAddress(gap.start),
      end: formatAddress(gap.end),
      sizeBytes: Number(size),
      sizeSource: "dwarf",
      label: "",
      type: null,
      value: null,
      variable: null,
      address: formatAddress(gap.start),
      changedBytes: [],
      readable,
      clipped: false,
      top: yFor(gap.end, windowEnd) - frameTopPx,
      height: Math.max(1, sizeFor(gap.start, gap.end)),
      pin: false,
      overlaps: false,
    });
    unknownRanges.push({
      start: formatAddress(gap.start),
      end: formatAddress(gap.end),
      readable,
    });
  }
  return { blocks, unknownRanges };
}

// ---------------------------------------------------------------------------
// Public build entry
// ---------------------------------------------------------------------------

export function buildStackMap(snapshot: Snapshot | null): StackMapModel {
  if (!snapshot) return EMPTY_MODEL;
  const windowStart = parseAddress(snapshot.stack.range_start);
  const windowEnd = parseAddress(snapshot.stack.range_end);
  if (windowStart === null || windowEnd === null || windowEnd <= windowStart) {
    return {
      ...EMPTY_MODEL,
      reason: "no-window",
      callChain: buildCallChain(snapshot.frames, new Set()),
      registerVariables: snapshot.variables.filter((node) => node.location_kind !== "memory"),
    };
  }
  const span = windowEnd - windowStart;
  const contentHeight = sizeFor(windowStart, windowEnd);
  if (span <= 0n) return EMPTY_MODEL;

  const map = buildByteMap(snapshot.stack.rows, windowStart, windowEnd);
  const rsp = parseAddress(snapshot.registers.rsp ?? null);
  const rbp = parseAddress(snapshot.registers.rbp ?? null);
  const rspInWindow = rsp !== null && within(rsp, windowStart, windowEnd);
  const rbpInWindow = rbp !== null && within(rbp, windowStart, windowEnd);

  const changedByAddress = new Map<string, MemoryChange>();
  for (const change of snapshot.diff.changed_bytes) {
    const normalized = normalizeAddress(change.address);
    if (normalized) changedByAddress.set(normalized, change);
  }
  const changeMarks: StackChangeMark[] = [];
  for (const [address, change] of changedByAddress) {
    const parsed = parseAddress(address);
    if (parsed === null || !within(parsed, windowStart, windowEnd)) continue;
    changeMarks.push({
      address,
      before: change.before,
      after: change.after,
      top: yFor(parsed, windowEnd),
    });
  }
  changeMarks.sort((left, right) => left.top - right.top);

  const { placed, unplaced } = placeVariables(
    snapshot.variables,
    windowStart,
    windowEnd,
    snapshot.pointer_bits || 64,
  );
  const registerVariables = snapshot.variables.filter(
    (node) => node.location_kind !== "memory" && node.location_kind !== "optimized_out",
  );

  const { verified, gdbFrames } = deriveVerifiedFrames(
    snapshot.frames ?? [],
    map,
    rsp,
    rbp,
    windowStart,
    windowEnd,
  );
  const entryFrames = verified.length === 0
    ? deriveEntryFrames(gdbFrames, map, rsp, rbp, windowStart, windowEnd)
    : [];
  const drawn: VerifiedFrame[] = verified.length > 0 ? verified : entryFrames;
  const memoryVisibleLevels = new Set(drawn.map((frame) => frame.level));

  const frames: StackFrameExtent[] = [];

  if (drawn.length === 0 && rsp !== null) {
    // No corroborated frame pointer and no provable return-address slot. Still
    // show the real current stack region from RSP upward, clearly marked as
    // having an unknown upper boundary.
    const gdbFrame = gdbFrames[0] ?? null;
    frames.push(
      makeFrame(
        {
          level: 0,
          base: 0n,
          start: rsp,
          end: windowEnd,
          savedRbp: null,
          savedRbpSlot: null,
          returnAddress: null,
          returnAddressSlot: null,
          verified: false,
        },
        gdbFrame,
        placed,
        map,
        changedByAddress,
        windowEnd,
        registerVariables,
      ),
    );
  } else {
    for (const frame of drawn) {
      const gdbFrame = gdbFrames[frame.level] ?? null;
      frames.push(
        makeFrame(
          frame,
          gdbFrame,
          placed,
          map,
          changedByAddress,
          windowEnd,
          frame.level === 0 ? registerVariables : [],
        ),
      );
    }
  }

  const allBlocks = frames.flatMap((frame) => frame.blocks);

  // Bytes below RSP are real stack bytes, but they are not part of any active
  // frame. Show them as their own neutral band instead of assigning ownership.
  let belowRsp: StackMapBlock | null = null;
  if (rspInWindow && rsp !== null && rsp > windowStart) {
    const end = rsp;
    belowRsp = {
      id: "below-rsp",
      kind: "below-rsp",
      frameLevel: null,
      start: formatAddress(windowStart),
      end: formatAddress(end),
      sizeBytes: Number(end - windowStart),
      sizeSource: "dwarf",
      label: "",
      type: null,
      value: null,
      variable: null,
      address: formatAddress(windowStart),
      changedBytes: [],
      readable: rangeReadable(map, windowStart, end),
      clipped: false,
      top: yFor(end, windowEnd),
      height: Math.max(1, sizeFor(windowStart, end)),
      pin: false,
      overlaps: false,
    };
  }

  let aboveFrames: StackMapBlock | null = null;
  const topFrame =
    frames.length > 0
      ? frames.reduce((highest, frame) => {
          const highestEnd = parseAddress(highest.end) ?? 0n;
          const frameEnd = parseAddress(frame.end) ?? 0n;
          return frameEnd > highestEnd ? frame : highest;
        })
      : null;
  if (topFrame) {
    const topEnd = parseAddress(topFrame.end);
    if (topEnd !== null && topEnd < windowEnd) {
      aboveFrames = {
        id: "above-frames",
        kind: "above-frames",
        frameLevel: null,
        start: formatAddress(topEnd),
        end: formatAddress(windowEnd),
        sizeBytes: Number(windowEnd - topEnd),
        sizeSource: "dwarf",
        label: "",
        type: null,
        value: null,
        variable: null,
        address: formatAddress(topEnd),
        changedBytes: [],
        readable: rangeReadable(map, topEnd, windowEnd),
        clipped: false,
        top: 0,
        height: Math.max(1, sizeFor(topEnd, windowEnd)),
        pin: false,
        overlaps: false,
      };
    }
  }

  const pointerLinks = buildPointerLinks(placed, allBlocks, windowStart, windowEnd);

  const rulerTicks: Array<{ address: string; top: number; major: boolean }> = [];
  const firstTick = windowEnd - 8n;
  for (let address = firstTick; address >= windowStart; address -= 8n) {
    const major = (address - windowStart) % BigInt(RULER_LABEL_STEP) === 0n;
    rulerTicks.push({
      address: formatAddress(address),
      top: yFor(address, windowEnd) + STACK_MAP_PX_PER_BYTE,
      major,
    });
    if (rulerTicks.length > 4096) break;
  }

  const callChain = buildCallChain(gdbFrames, memoryVisibleLevels);

  return {
    available: true,
    reason: rspInWindow ? "ready" : "no-stack-pointer",
    windowStart: formatAddress(windowStart),
    windowEnd: formatAddress(windowEnd),
    contentHeight,
    pxPerByte: STACK_MAP_PX_PER_BYTE,
    rsp: rsp === null ? null : formatAddress(rsp),
    rbp: rbp === null ? null : formatAddress(rbp),
    rip: normalizeAddress(snapshot.registers.rip ?? null),
    rspTop: rspInWindow && rsp !== null ? yFor(rsp, windowEnd) : null,
    rbpTop: rbpInWindow && rbp !== null ? yFor(rbp, windowEnd) : null,
    frames,
    callChain,
    blocks: allBlocks,
    pointerLinks,
    changeMarks,
    belowRsp,
    aboveFrames,
    unplacedVariables: unplaced,
    registerVariables,
    changedCount: changeMarks.length,
    unreadableCount: snapshot.stack.unreadable_ranges.length,
    rulerTicks,
    firstFrameLevel: frames.length > 0 ? frames[0].level : null,
  };
}

function makeFrame(
  frame: VerifiedFrame,
  gdbFrame: Frame | null,
  placed: VariablePlacement[],
  map: ByteMap,
  changedByAddress: Map<string, MemoryChange>,
  windowEnd: bigint,
  registerVariables: VariableNode[],
): StackFrameExtent {
  const top = yFor(frame.end, windowEnd);
  const height = Math.max(1, sizeFor(frame.start, frame.end));
  const own = placed.filter((placement) => {
    const midpoint = placement.start;
    return midpoint >= frame.start && midpoint < frame.end;
  });
  const blocks: StackMapBlock[] = [];
  const knownRanges: Array<{ start: bigint; end: bigint }> = [];

  if (frame.savedRbpSlot !== null && frame.savedRbp !== null) {
    const savedStart = frame.savedRbpSlot;
    const savedEnd = savedStart + 8n;
    if (savedStart >= frame.start && savedEnd <= frame.end) {
      const savedBlock: StackMapBlock = {
        id: `saved-rbp:${frame.level}`,
        kind: "saved-rbp",
        frameLevel: frame.level,
        start: formatAddress(savedStart),
        end: formatAddress(savedEnd),
        sizeBytes: 8,
        sizeSource: "dwarf",
        label: "",
        type: null,
        value: frame.savedRbp,
        variable: null,
        address: formatAddress(savedStart),
        changedBytes: changedInRange(changedByAddress, savedStart, savedEnd),
        readable: rangeReadable(map, savedStart, savedEnd),
        clipped: false,
        top: yFor(savedEnd, windowEnd) - top,
        height: sizeFor(savedStart, savedEnd),
        pin: false,
        overlaps: false,
      };
      blocks.push(savedBlock);
      knownRanges.push({ start: savedStart, end: savedEnd });
    }
  }
  if (frame.returnAddressSlot !== null && frame.returnAddress !== null) {
    const returnStart = frame.returnAddressSlot;
    const returnEnd = returnStart + 8n;
    if (returnStart >= frame.start && returnEnd <= frame.end) {
      const returnBlock: StackMapBlock = {
        id: `return-address:${frame.level}`,
        kind: "return-address",
        frameLevel: frame.level,
        start: formatAddress(returnStart),
        end: formatAddress(returnEnd),
        sizeBytes: 8,
        sizeSource: "dwarf",
        label: "",
        type: null,
        value: frame.returnAddress,
        variable: null,
        address: formatAddress(returnStart),
        changedBytes: changedInRange(changedByAddress, returnStart, returnEnd),
        readable: rangeReadable(map, returnStart, returnEnd),
        clipped: false,
        top: yFor(returnEnd, windowEnd) - top,
        height: sizeFor(returnStart, returnEnd),
        pin: false,
        overlaps: false,
      };
      blocks.push(returnBlock);
      knownRanges.push({ start: returnStart, end: returnEnd });
    }
  }

  for (const placement of own) {
    const block = blockFromPlacement(placement, top, windowEnd, changedByAddress, map);
    blocks.push(block);
    knownRanges.push({ start: placement.start, end: placement.end });
  }

  const unknown = frameUnknownBlocks(frame, top, knownRanges, map, windowEnd);
  blocks.push(...unknown.blocks);
  blocks.sort((left, right) => left.top - right.top);

  // Mark visual overlap (e.g. unions/aliases) instead of silently stacking.
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1];
    if (previous.kind === "variable" && blocks[index].kind === "variable") {
      const previousBottom = previous.top + previous.height;
      if (blocks[index].top < previousBottom - 0.5) {
        blocks[index].overlaps = true;
      }
    }
  }

  const variables = own.map((placement) => placement.node);
  return {
    level: frame.level,
    function: gdbFrame?.function ?? null,
    file: gdbFrame?.file ?? null,
    line: gdbFrame?.line ?? null,
    start: formatAddress(frame.start),
    end: formatAddress(frame.end),
    base: frame.verified ? formatAddress(frame.base) : null,
    verified: frame.verified,
    returnAddress: frame.returnAddress,
    returnAddressBlockId:
      frame.returnAddressSlot !== null ? `return-address:${frame.level}` : null,
    savedRbp: frame.savedRbp,
    savedRbpBlockId:
      frame.savedRbpSlot !== null ? `saved-rbp:${frame.level}` : null,
    blocks,
    variables,
    registerVariables,
    unknownRanges: unknown.unknownRanges,
    top,
    height,
  };
}

function changedInRange(
  changedByAddress: Map<string, MemoryChange>,
  start: bigint,
  end: bigint,
): MemoryChange[] {
  const result: MemoryChange[] = [];
  for (const change of changedByAddress.values()) {
    const address = parseAddress(change.address);
    if (address !== null && within(address, start, end)) result.push(change);
  }
  return result.sort((left, right) => (left.address < right.address ? -1 : 1));
}

function buildCallChain(
  gdbFrames: Frame[],
  verifiedLevels: Set<number>,
): StackCallChainEntry[] {
  return [...gdbFrames]
    .sort((left, right) => left.level - right.level)
    .map((frame) => ({
      level: frame.level,
      function: frame.function,
      file: frame.file,
      line: frame.line,
      address: normalizeAddress(frame.address),
      memoryVisible: verifiedLevels.has(frame.level),
    }));
}

function buildPointerLinks(
  placed: VariablePlacement[],
  blocks: StackMapBlock[],
  windowStart: bigint,
  windowEnd: bigint,
): PointerLink[] {
  const links: PointerLink[] = [];
  const blockByAddress = new Map<string, StackMapBlock>();
  for (const block of blocks) {
    if (block.kind === "unknown" || block.kind === "unreadable") continue;
    blockByAddress.set(normalizeAddress(block.start) ?? block.start, block);
  }

  for (const placement of placed) {
    const node = placement.node;
    if (node.kind !== "pointer" || !node.pointer_target) continue;
    const from = blocks.find(
      (block) =>
        block.kind === "variable" &&
        block.variable === node &&
        block.start === formatAddress(placement.start),
    );
    if (!from) continue;
    const target = normalizeAddress(node.pointer_target);
    if (!target) continue;
    const parsedTarget = parseAddress(target);
    if (parsedTarget === null) continue;

    if (parsedTarget === 0n) {
      links.push(basePointerLink(node, from, target, "null", null, "none", links.length));
      continue;
    }

    const exact = blockByAddress.get(target);
    if (exact) {
      links.push(
        basePointerLink(
          node,
          from,
          target,
          "resolved",
          exact,
          exact.kind === "variable" ? "variable" : exact.kind === "saved-rbp" ? "saved-rbp" : "return-address",
          links.length,
        ),
      );
      continue;
    }

    // A pointer into the middle of a known block is still an exact address.
    const containing = blocks.find((block) => {
      if (block.kind === "unknown" || block.kind === "unreadable") return false;
      const start = parseAddress(block.start);
      const end = parseAddress(block.end);
      return start !== null && end !== null && within(parsedTarget, start, end);
    });
    if (containing) {
      links.push(
        basePointerLink(node, from, target, "resolved", containing, "variable", links.length),
      );
      continue;
    }

    if (within(parsedTarget, windowStart, windowEnd)) {
      // The target address is inside the visible stack window but not a known
      // object. Draw a dashed arrow to the real byte; never name it.
      links.push(
        basePointerLink(node, from, target, "unresolved", null, "unknown", links.length),
      );
      continue;
    }

    if (node.target_readable === false) {
      links.push(
        basePointerLink(node, from, target, "unreadable", null, "none", links.length),
      );
      continue;
    }
    links.push(
      basePointerLink(node, from, target, "outside-window", null, "none", links.length),
    );
  }
  return links;
}

function basePointerLink(
  node: VariableNode,
  from: StackMapBlock,
  target: string,
  state: PointerLinkState,
  targetBlock: StackMapBlock | null,
  targetKind: PointerLink["targetKind"],
  laneIndex: number,
): PointerLink {
  return {
    id: `ptr:${node.name}:${from.start}:${target}`,
    variableName: node.name,
    fromBlockId: from.id,
    fromAddress: from.start,
    targetAddress: target,
    targetBlockId: targetBlock?.id ?? null,
    targetKind,
    state,
    targetReadable: node.target_readable ?? null,
    targetBytes: node.target_bytes ?? null,
    targetString: node.target_string ?? null,
    laneIndex,
  };
}

/** Real bytes at a block's start, decoded as a little-endian qword when possible. */
export function blockQword(
  snapshot: Snapshot | null,
  block: { start: string; sizeBytes: number | null },
): string | null {
  const bytes = readSnapshotBytes(snapshot, block.start, 8);
  if (bytes.length < 8 || bytes.some((byte) => byte === null)) return null;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(Number.parseInt(bytes[index] as string, 16)) << BigInt(index * 8);
  }
  return formatAddress(value);
}

/** Real ASCII view for a block (max 32 bytes). */
export function blockAscii(snapshot: Snapshot | null, start: string): string | null {
  const bytes = readSnapshotBytes(snapshot, start, 32);
  if (bytes.length === 0) return null;
  let text = "";
  for (const byte of bytes) {
    if (byte === null) break;
    const value = Number.parseInt(byte, 16);
    if (value === 0) break;
    text += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : ".";
  }
  return text || null;
}

export function blockForAddress(
  model: StackMapModel,
  address: string | null,
): StackMapBlock | null {
  const target = parseAddress(address);
  if (target === null) return null;
  return (
    model.blocks.find((block) => {
      const start = parseAddress(block.start);
      const end = parseAddress(block.end);
      return start !== null && end !== null && within(target, start, end);
    }) ?? null
  );
}

/**
 * Absolute content-space Y coordinate of one address. It is intentionally a
 * pure function of the visible window so block positions, the ruler, pointer
 * arrows and scroll targets all share exactly the same coordinate system.
 */
export function addressTop(model: StackMapModel, address: string | null): number | null {
  const target = parseAddress(address);
  const windowEnd = parseAddress(model.windowEnd);
  if (target === null || windowEnd === null) return null;
  return Number(windowEnd - target) * model.pxPerByte;
}
