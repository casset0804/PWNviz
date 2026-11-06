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
 *  - variable ownership is double-checked: the GDB/DWARF `frame_level` claim
 *    must agree with the frame whose real byte range contains the variable's
 *    address. When the two disagree the variable is never force-attached to a
 *    frame; it is drawn at its true address and marked `conflict`. When the
 *    evidence is insufficient the variable is marked `unresolved`. Ownership
 *    is never guessed from a variable name;
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

/** Vertical pixels per real stack byte at "actual scale" (100 %). */
export const STACK_MAP_PX_PER_BYTE = 10;
/**
 * Zoom bounds. The lower bound keeps blocks, labels and arrows readable when a
 * deep stack is fitted; the upper bound keeps the drawing honest.
 */
export const STACK_MAP_MIN_PX_PER_BYTE = 1;
export const STACK_MAP_MAX_PX_PER_BYTE = 120;
/** Breathing room kept inside the viewport for the fit modes (pixels). */
export const STACK_MAP_FIT_PADDING = 24;
/**
 * Blocks shorter than this never carry internal text: 1-byte (10 px) and
 * 2-byte (20 px) blocks cannot hold a readable line. Their names are drawn
 * outside the byte area (frame-label gutter) and the full details are on
 * hover; the block itself keeps its exact real byte geometry.
 */
export const STACK_MAP_MICRO_BLOCK_PX = 26;
/**
 * Horizontal pixels per pointer-routing lane. The routing area grows with the
 * number of *visible* links (see pointerLaneWidth), so every arrow keeps its
 * own orthogonal channel instead of sharing one control point.
 */
export const STACK_MAP_POINTER_LANE = 18;
/** Hard cap on simultaneously drawn routing lanes (keeps the map usable). */
export const STACK_MAP_MAX_POINTER_LANES = 12;
/** The address ruler's width (left-aligned real addresses). */
export const STACK_MAP_RULER_WIDTH = 160;
/**
 * Dedicated diff gutter between the address ruler and the memory spine.
 * Unattributed memory changes render as small markers here and are never
 * allowed to stretch across the memory area.
 */
export const STACK_MAP_DIFF_GUTTER_WIDTH = 12;
/**
 * The memory spine: a fixed-width vertical column. Real byte geometry maps to
 * its HEIGHT only — the width never stretches with the container, so the map
 * reads as a stack column instead of a full-screen rectangle.
 */
export const STACK_MAP_SPINE_WIDTH = 320;
/** Hard upper bound for the spine width (visual acceptance limit). */
export const STACK_MAP_SPINE_MAX_WIDTH = 360;
/** Right-hand gutter holding the RSP/RBP locator chips and arrows. */
export const STACK_MAP_MARKER_GUTTER = 88;
/** Left edge of the spine inside the centered column group. */
export const STACK_MAP_SPINE_LEFT = STACK_MAP_RULER_WIDTH + STACK_MAP_DIFF_GUTTER_WIDTH;
/** Left edge of the marker gutter inside the column group. */
export const STACK_MAP_MARKER_LEFT = STACK_MAP_SPINE_LEFT + STACK_MAP_SPINE_WIDTH;
/** Total width of the centered column group (ruler | gutter | spine | markers). */
export const STACK_MAP_COLUMN_GROUP = STACK_MAP_MARKER_LEFT + STACK_MAP_MARKER_GUTTER;
/** Safety cap: a snapshot never needs more than a handful of drawn frames. */
export const MAX_RENDERED_FRAMES = 6;

export interface MemoryChangeGroup {
  /** First changed address (inclusive, formatted). */
  start: string;
  /** End of the changed run (exclusive, formatted). */
  end: string;
  /** Number of changed bytes in the run. */
  count: number;
  /**
   * The original diff entries, sorted by address — before/after values are
   * preserved per byte and never aggregated away.
   */
  changes: MemoryChange[];
}

/**
 * Merge byte-level diff entries into runs of contiguous addresses.
 *
 * `0x1000/0x1001/0x1002 + 0x1008` becomes one group `[0x1000, 0x1003)` and one
 * single-byte group `[0x1008, 0x1009)`. Every original entry keeps its own
 * before/after; grouping only affects the visual merge, never the data.
 */
export function groupMemoryChangesByAddress(changes: MemoryChange[]): MemoryChangeGroup[] {
  const parsed = changes
    .map((change) => ({ change, address: parseAddress(change.address) }))
    .filter((entry): entry is { change: MemoryChange; address: bigint } => entry.address !== null)
    .sort((left, right) => (left.address < right.address ? -1 : left.address > right.address ? 1 : 0));

  const groups: MemoryChangeGroup[] = [];
  let current: { start: bigint; end: bigint; changes: MemoryChange[] } | null = null;
  const flush = (): void => {
    if (current) {
      groups.push({
        start: formatAddress(current.start),
        end: formatAddress(current.end),
        count: current.changes.length,
        changes: current.changes,
      });
    }
  };
  for (const entry of parsed) {
    if (current && entry.address === current.end) {
      current.end = entry.address + 1n;
      current.changes.push(entry.change);
    } else {
      flush();
      current = { start: entry.address, end: entry.address + 1n, changes: [entry.change] };
    }
  }
  flush();
  return groups;
}

export interface ChangeGroupLayout {
  group: MemoryChangeGroup;
  /** Top edge relative to the reference address's own row (pixels). */
  top: number;
  /** Merged run height in pixels (at least 2 so a single byte stays visible). */
  height: number;
}

/**
 * Lay out merged change groups under a reference address (the block's
 * exclusive end, or the window end for the diff gutter). The geometry is the
 * same addressTop() transform: a run of N bytes spans exactly N × pxPerByte.
 */
export function layoutChangeGroups(
  groups: MemoryChangeGroup[],
  topAddressExclusive: string,
  pxPerByte: number,
): ChangeGroupLayout[] {
  const topAddress = parseAddress(topAddressExclusive);
  if (topAddress === null) return [];
  const layouts: ChangeGroupLayout[] = [];
  for (const group of groups) {
    const start = parseAddress(group.start);
    const end = parseAddress(group.end);
    if (start === null || end === null) continue;
    const top = Number(topAddress - end) * pxPerByte;
    if (top < 0) continue;
    layouts.push({
      group,
      top,
      height: Math.max(2, Number(end - start) * pxPerByte),
    });
  }
  return layouts.sort((left, right) => left.top - right.top);
}

/**
 * Routing-area width for the given number of *visible* pointer links. Lanes
 * are only reserved for links that will actually be drawn, and the width grows
 * linearly so two arrows can never be squeezed onto one X coordinate.
 */
export function pointerLaneWidth(visibleLinkCount: number): number {
  if (visibleLinkCount <= 0) return 12;
  const lanes = Math.min(visibleLinkCount, STACK_MAP_MAX_POINTER_LANES);
  return lanes * STACK_MAP_POINTER_LANE + 20;
}

/**
 * Pointer-lane assignment happens AFTER invalid links are filtered out — the
 * V1.3 bug was assigning laneIndex while building every link, so skipped
 * states left holes and high indices collapsed onto one clamped control point.
 *
 * Links are sorted by their (unknown) geometry-independent key first and then
 * numbered densely 0..n-1; the canvas sorts by rendered Y before calling this
 * so lower arrows get inner lanes and runs stay deterministic.
 */
export function assignPointerLanes<T extends object>(
  visible: T[],
  orderKey: (link: T) => number,
): Array<T & { laneIndex: number }> {
  return [...visible]
    .sort((left, right) => orderKey(left) - orderKey(right))
    .map((link, index) => ({ ...link, laneIndex: index }));
}

/**
 * Zoom modes. "actual" keeps the fixed teaching scale (10 px per real byte);
 * the fit modes only *derive* a scale from the viewport — every block, tick,
 * marker and arrow still uses that one shared px/byte, so the address mapping
 * can never drift.
 */
export type StackMapZoomMode = "actual" | "fit-frame" | "fit-stack";

/** Ruler density: presentation keeps few major ticks only, developer is denser. */
export type StackMapRulerMode = "presentation" | "developer";

interface RulerTick {
  address: string;
  top: number;
  major: boolean;
}

/**
 * Adaptive ruler ticks.
 *
 * - presentation: major ticks only, spaced at least ~56 px apart (32/64/128…
 *   real bytes depending on zoom); no minor 1-px hairlines;
 * - developer: major ticks every 8/16/32… bytes plus optional minor ticks when
 *   they would not crowd (≥ 14 px apart);
 * - tick Y positions use the same addressTop() transform as the blocks, so an
 *   address label always sits exactly at its byte row at any zoom level.
 */
export function buildRulerTicks(
  windowStart: bigint,
  windowEnd: bigint,
  pxPerByte: number,
  mode: StackMapRulerMode,
): RulerTick[] {
  const span = windowEnd - windowStart;
  if (span <= 0n || pxPerByte <= 0) return [];

  const candidates = mode === "developer" ? [8, 16, 32, 64, 128, 256, 512] : [32, 64, 128, 256, 512, 1024];
  const minMajorPx = mode === "developer" ? 40 : 56;
  const majorStep = BigInt(candidates.find((step) => step * pxPerByte >= minMajorPx) ?? candidates[candidates.length - 1] * 2);

  const minorStep =
    mode === "developer" && Number(majorStep) / 2 >= 1 && (Number(majorStep) / 2) * pxPerByte >= 14
      ? majorStep / 2n
      : null;
  const walkStep = minorStep ?? majorStep;

  const ticks: RulerTick[] = [];
  const firstTick = windowEnd - (windowEnd % walkStep === 0n ? walkStep : (windowEnd % walkStep));
  for (let address = firstTick; address >= windowStart; address -= walkStep) {
    const major = (windowEnd - address) % majorStep === 0n;
    ticks.push({
      address: formatAddress(address),
      top: Number(windowEnd - address) * pxPerByte + pxPerByte,
      major,
    });
    if (ticks.length > 4096) break;
  }
  return ticks;
}

export function clampPxPerByte(pxPerByte: number): number {
  if (!Number.isFinite(pxPerByte) || pxPerByte <= 0) return STACK_MAP_PX_PER_BYTE;
  return Math.min(
    STACK_MAP_MAX_PX_PER_BYTE,
    Math.max(STACK_MAP_MIN_PX_PER_BYTE, pxPerByte),
  );
}

/** px/byte so the whole visible stack window fits the viewport height. */
export function fitStackPxPerByte(viewportHeight: number, spanBytes: number): number {
  if (viewportHeight <= STACK_MAP_FIT_PADDING || spanBytes <= 0) {
    return STACK_MAP_PX_PER_BYTE;
  }
  return clampPxPerByte((viewportHeight - STACK_MAP_FIT_PADDING) / spanBytes);
}

/** px/byte so the current frame fills the viewport height. */
export function fitFramePxPerByte(viewportHeight: number, frameBytes: number): number {
  if (viewportHeight <= STACK_MAP_FIT_PADDING * 2 || frameBytes <= 0) {
    return STACK_MAP_PX_PER_BYTE;
  }
  return clampPxPerByte((viewportHeight - STACK_MAP_FIT_PADDING * 2) / frameBytes);
}

/** Zoom percentage relative to actual scale (10 px/byte = 100 %). */
export function zoomPercent(pxPerByte: number): number {
  return Math.round((pxPerByte / STACK_MAP_PX_PER_BYTE) * 100);
}

export interface GutterAnnotation {
  blockId: string;
  label: string;
  assignment: VariableAssignmentState | null;
  /** Frame-relative Y of the annotation chip's top edge. */
  chipTop: number;
  /** Frame-relative Y the chip points at (the block's vertical centre). */
  anchorTop: number;
}

/**
 * Place external name chips for micro variable blocks in the frame-label
 * gutter, next to (never inside) their byte block.
 *
 * Chips stack top-down and are pushed apart so two adjacent micro variables
 * (e.g. `char` above `short`, 10 px apart) never overlap each other; the chip
 * keeps a leader anchor pointing at the block's real centre. Chips never
 * render inside the byte area, so block geometry is untouched.
 */
export function layoutGutterAnnotations(
  blocks: Array<{
    id: string;
    kind: StackMapBlockKind;
    label: string;
    top: number;
    height: number;
    assignment: VariableAssignmentState | null;
  }>,
  options: { chipHeight?: number; gap?: number; minTop?: number } = {},
): GutterAnnotation[] {
  const chipHeight = options.chipHeight ?? 18;
  const gap = options.gap ?? 3;
  const minTop = Math.max(0, options.minTop ?? 0);
  const candidates = blocks
    .filter(
      (block) =>
        block.kind === "variable" && Boolean(block.label) && block.height < STACK_MAP_MICRO_BLOCK_PX,
    )
    .sort((left, right) => left.top - right.top);
  const result: GutterAnnotation[] = [];
  let cursor = minTop;
  for (const block of candidates) {
    const anchorTop = block.top + block.height / 2;
    const chipTop = Math.max(anchorTop - chipHeight / 2, cursor);
    result.push({
      blockId: block.id,
      label: block.label,
      assignment: block.assignment,
      chipTop,
      anchorTop,
    });
    cursor = chipTop + chipHeight + gap;
  }
  return result;
}

export type StackMapBlockKind =
  | "variable"
  | "saved-rbp"
  | "return-address"
  | "unknown"
  | "unreadable"
  | "below-rsp"
  | "above-frames";

export type VariableSizeSource = "dwarf" | "abi" | "unknown";

/**
 * Evidence-backed variable ownership.
 *
 *  - `verified`   — the GDB `frame_level` claim and the frame whose real byte
 *                   range contains the address agree;
 *  - `conflict`   — the claimed frame is visible in the window but the address
 *                   provably lives outside (or inside another) frame. The
 *                   variable is drawn at its true address but never attached
 *                   to a frame's variable list;
 *  - `unresolved` — insufficient evidence (claimed level not drawn, or the
 *                   address lies outside every drawn frame).
 */
export type VariableAssignmentState = "verified" | "conflict" | "unresolved";

export type VariableAssignmentReason =
  | "level-and-address-agree"
  | "within-frame-region"
  | "address-in-other-frame"
  | "address-outside-claimed-frame"
  | "claimed-frame-not-visible"
  | "outside-verified-frames"
  | "frame-level-missing";

export interface VariableAssignment {
  variableName: string;
  /** Real start address of the variable. */
  address: string;
  /** `frame_level` as reported by GDB/DWARF (null when not reported). */
  claimedFrameLevel: number | null;
  /** Level of the drawn frame whose byte range contains the address. */
  geometricFrameLevel: number | null;
  state: VariableAssignmentState;
  reason: VariableAssignmentReason;
}

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
  /** Ownership evidence for variable blocks; null for bookkeeping bands. */
  assignment: VariableAssignmentState | null;
  assignmentReason: VariableAssignmentReason | null;
  /**
   * Signed offset from the owning frame's base (e.g. "-0x14" for a local at
   * rbp-0x14, "+0x0" for the saved RBP slot). Null when no verified base.
   */
  frameOffset: string | null;
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
  /** In-window memory variables with their ownership evidence, one per variable. */
  variableAssignments: VariableAssignment[];
  /** Verified + conflict + unresolved variable blocks, at their true addresses. */
  unframedBlocks: StackMapBlock[];
  /** conflict + unresolved count (ownership could not be proven). */
  unverifiedCount: number;
  changedCount: number;
  unreadableCount: number;
  rulerTicks: Array<{ address: string; top: number; major: boolean }>;
  firstFrameLevel: number | null;
};

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
  variableAssignments: [],
  unframedBlocks: [],
  unverifiedCount: 0,
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

function yFor(address: bigint, windowEnd: bigint, pxPerByte: number): number {
  return Number(windowEnd - address) * pxPerByte;
}

function sizeFor(start: bigint, end: bigint, pxPerByte: number): number {
  return Number(end - start) * pxPerByte;
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

/** Geometry-only placement, before ownership is cross-checked. */
interface VariablePlacementBase {
  node: VariableNode;
  start: bigint;
  end: bigint;
  size: number | null;
  source: VariableSizeSource;
  clipped: boolean;
}

interface VariablePlacement extends VariablePlacementBase {
  /** Level of the drawn frame containing the start address (null = none). */
  geometricFrameLevel: number | null;
  assignment: VariableAssignmentState;
  assignmentReason: VariableAssignmentReason;
}

/**
 * Double-check variable ownership against real memory.
 *
 * The GDB/DWARF `frame_level` is the primary claim; the frame whose drawn byte
 * range contains the variable's start address is the geometric evidence.
 *
 *  - both present and equal            -> verified;
 *  - claimed frame drawn, evidence says otherwise -> conflict (never attached
 *    to a frame's variable list, drawn at the true address);
 *  - claimed frame not drawn, or address outside every drawn frame -> unresolved.
 *
 * Ownership is never inferred from the variable name.
 */
function annotateVariableFrames(
  placed: VariablePlacementBase[],
  drawn: VerifiedFrame[],
  windowStart: bigint,
  rsp: bigint | null,
): VariablePlacement[] {
  return placed.map((placement) => {
    const container = drawn.find(
      (frame) => placement.start >= frame.start && placement.start < frame.end,
    );
    const geometricFrameLevel = container ? container.level : null;
    const claimed =
      typeof placement.node.frame_level === "number" &&
      Number.isFinite(placement.node.frame_level)
        ? placement.node.frame_level
        : null;
    const claimedFrame =
      claimed === null ? null : drawn.find((frame) => frame.level === claimed) ?? null;

    if (claimed === null) {
      return {
        ...placement,
        geometricFrameLevel,
        assignment: "unresolved" as const,
        assignmentReason: "frame-level-missing" as const,
      };
    }
    if (claimedFrame && container) {
      if (claimedFrame.level === container.level) {
        return {
          ...placement,
          geometricFrameLevel,
          assignment: "verified" as const,
          assignmentReason: "level-and-address-agree" as const,
        };
      }
      return {
        ...placement,
        geometricFrameLevel,
        assignment: "conflict" as const,
        assignmentReason: "address-in-other-frame" as const,
      };
    }
    if (claimedFrame && !container) {
      // Leaf functions may keep locals below RSP in the x86-64 red zone, so an
      // address outside the drawn extent is only a contradiction when it does
      // not sit in the plausible local region: from the deepest boundary below
      // the frame up to its base (plus the incoming-args area above it).
      const below = drawn.find((frame) => frame.level === claimedFrame.level - 1);
      // No frame below: locals may sit in the x86-64 red zone (128 bytes below
      // RSP), never further — anything deeper cannot be a live local.
      const redZoneFloor = rsp !== null ? rsp - 128n : windowStart;
      const lowerBound = below
        ? below.end
        : redZoneFloor > windowStart
          ? redZoneFloor
          : windowStart;
      const upperBound =
        claimedFrame.base > 0n ? claimedFrame.base + 16n : claimedFrame.end;
      const inPlausibleRegion =
        placement.start >= lowerBound && placement.start <= upperBound;
      if (inPlausibleRegion) {
        return {
          ...placement,
          geometricFrameLevel: claimedFrame.level,
          assignment: "verified" as const,
          assignmentReason: "within-frame-region" as const,
        };
      }
      // Positive contradiction: the claimed frame is visible, so its real
      // extent is known, and the address provably lies outside its region.
      return {
        ...placement,
        geometricFrameLevel,
        assignment: "conflict" as const,
        assignmentReason: "address-outside-claimed-frame" as const,
      };
    }
    if (!claimedFrame && container) {
      return {
        ...placement,
        geometricFrameLevel,
        assignment: "unresolved" as const,
        assignmentReason: "claimed-frame-not-visible" as const,
      };
    }
    return {
      ...placement,
      geometricFrameLevel: null,
      assignment: "unresolved" as const,
      assignmentReason: "outside-verified-frames" as const,
    };
  });
}

function assignmentFor(placement: VariablePlacement): {
  assignment: VariableAssignmentState;
  assignmentReason: VariableAssignmentReason;
} {
  return {
    assignment: placement.assignment,
    assignmentReason: placement.assignmentReason,
  };
}

function placeVariables(
  nodes: VariableNode[],
  windowStart: bigint,
  windowEnd: bigint,
  pointerBits: number,
): { placed: VariablePlacementBase[]; unplaced: VariableNode[] } {
  const placed: VariablePlacementBase[] = [];
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
  pxPerByte: number,
  frameBase: bigint | null,
): StackMapBlock {
  const node = placement.node;
  const top = yFor(placement.end, windowEnd, pxPerByte) - frameTopPx;
  const frameOffset =
    frameBase !== null && frameBase !== 0n
      ? formatSignedOffset(placement.start - frameBase)
      : null;
  const changedBytes: MemoryChange[] = [];
  for (const change of changedByAddress.values()) {
    const address = parseAddress(change.address);
    if (address !== null && within(address, placement.start, placement.end)) {
      changedBytes.push(change);
    }
  }
  return {
    // Zoom-stable id: the geometric frame level, not a pixel offset.
    id: `var:${placement.geometricFrameLevel ?? "u"}:${node.name}:${placement.start.toString(16)}`,
    kind: "variable",
    frameLevel: placement.geometricFrameLevel,
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
    height: Math.max(1, sizeFor(placement.start, placement.end, pxPerByte)),
    pin: placement.size === null,
    overlaps: false,
    ...assignmentFor(placement),
    frameOffset,
  };
}

/** Format a signed byte offset the way teaching UIs read it: "-0x14". */
export function formatSignedOffset(offset: bigint): string {
  return offset < 0n ? `-0x${(-offset).toString(16)}` : `+0x${offset.toString(16)}`;
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
  pxPerByte: number,
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
      top: yFor(gap.end, windowEnd, pxPerByte) - frameTopPx,
      height: Math.max(1, sizeFor(gap.start, gap.end, pxPerByte)),
      pin: false,
      overlaps: false,
      assignment: null,
      assignmentReason: null,
      frameOffset: formatSignedOffset(gap.start - frame.base),
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

export interface StackMapBuildOptions {
  /** Ruler density; presentation is the default teaching surface. */
  rulerMode?: StackMapRulerMode;
}

export function buildStackMap(
  snapshot: Snapshot | null,
  pxPerByte: number = STACK_MAP_PX_PER_BYTE,
  options: StackMapBuildOptions = {},
): StackMapModel {
  const scale = clampPxPerByte(pxPerByte);
  const rulerMode: StackMapRulerMode = options.rulerMode ?? "presentation";
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
  const contentHeight = sizeFor(windowStart, windowEnd, scale);
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
      top: yFor(parsed, windowEnd, scale),
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
  let drawn: VerifiedFrame[] = verified.length > 0 ? verified : entryFrames;
  if (drawn.length === 0 && rsp !== null) {
    // No corroborated frame pointer and no provable return-address slot. Still
    // show the real current stack region from RSP upward, clearly marked as
    // having an unknown upper boundary.
    drawn = [
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
    ];
  }
  const memoryVisibleLevels = new Set(drawn.map((frame) => frame.level));

  // Ownership is decided only after the real frame extents are known, so the
  // frame_level claim can be cross-checked against address evidence.
  const annotated = annotateVariableFrames(placed, drawn, windowStart, rsp);

  const frames: StackFrameExtent[] = drawn.map((frame) =>
    makeFrame(
      frame,
      gdbFrames[frame.level] ?? null,
      annotated,
      map,
      changedByAddress,
      windowEnd,
      frame.level === 0 ? registerVariables : [],
      scale,
    ),
  );

  // Variables whose address lies outside every drawn frame: drawn at their
  // true address, ownership explicitly unverified. They were silently dropped
  // before V1.3.
  const unframedBlocks = annotated
    .filter((placement) => placement.geometricFrameLevel === null)
    .map((placement) => blockFromPlacement(placement, 0, windowEnd, changedByAddress, map, scale, null))
    .sort((left, right) => left.top - right.top);

  const allBlocks = [...frames.flatMap((frame) => frame.blocks), ...unframedBlocks];

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
      top: yFor(end, windowEnd, scale),
      height: Math.max(1, sizeFor(windowStart, end, scale)),
      pin: false,
      overlaps: false,
      assignment: null,
      assignmentReason: null,
      frameOffset: null,
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
        height: Math.max(1, sizeFor(topEnd, windowEnd, scale)),
        pin: false,
        overlaps: false,
        assignment: null,
        assignmentReason: null,
        frameOffset: null,
      };
    }
  }

  const pointerLinks = buildPointerLinks(placed, allBlocks, windowStart, windowEnd);

  const variableAssignments: VariableAssignment[] = annotated.map((placement) => ({
    variableName: placement.node.name,
    address: formatAddress(placement.start),
    claimedFrameLevel:
      typeof placement.node.frame_level === "number" &&
      Number.isFinite(placement.node.frame_level)
        ? placement.node.frame_level
        : null,
    geometricFrameLevel: placement.geometricFrameLevel,
    state: placement.assignment,
    reason: placement.assignmentReason,
  }));
  const unverifiedCount = variableAssignments.filter(
    (entry) => entry.state !== "verified",
  ).length;

  const rulerTicks = buildRulerTicks(windowStart, windowEnd, scale, rulerMode);

  const callChain = buildCallChain(gdbFrames, memoryVisibleLevels);

  return {
    available: true,
    reason: rspInWindow ? "ready" : "no-stack-pointer",
    windowStart: formatAddress(windowStart),
    windowEnd: formatAddress(windowEnd),
    contentHeight,
    pxPerByte: scale,
    rsp: rsp === null ? null : formatAddress(rsp),
    rbp: rbp === null ? null : formatAddress(rbp),
    rip: normalizeAddress(snapshot.registers.rip ?? null),
    rspTop: rspInWindow && rsp !== null ? yFor(rsp, windowEnd, scale) : null,
    rbpTop: rbpInWindow && rbp !== null ? yFor(rbp, windowEnd, scale) : null,
    frames,
    callChain,
    blocks: allBlocks,
    pointerLinks,
    changeMarks,
    belowRsp,
    aboveFrames,
    unplacedVariables: unplaced,
    registerVariables,
    variableAssignments,
    unframedBlocks,
    unverifiedCount,
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
  pxPerByte: number,
): StackFrameExtent {
  const top = yFor(frame.end, windowEnd, pxPerByte);
  const height = Math.max(1, sizeFor(frame.start, frame.end, pxPerByte));
  // Placements were annotated against these same frame extents; a variable is
  // only drawn inside the frame whose byte range actually contains it.
  const own = placed.filter((placement) => placement.geometricFrameLevel === frame.level);
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
        top: yFor(savedEnd, windowEnd, pxPerByte) - top,
        height: sizeFor(savedStart, savedEnd, pxPerByte),
        pin: false,
        overlaps: false,
        assignment: null,
        assignmentReason: null,
        frameOffset: frame.verified && frame.base !== 0n ? "+0x0" : null,
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
        top: yFor(returnEnd, windowEnd, pxPerByte) - top,
        height: sizeFor(returnStart, returnEnd, pxPerByte),
        pin: false,
        overlaps: false,
        assignment: null,
        assignmentReason: null,
        frameOffset: frame.verified && frame.base !== 0n ? "+0x8" : null,
      };
      blocks.push(returnBlock);
      knownRanges.push({ start: returnStart, end: returnEnd });
    }
  }

  for (const placement of own) {
    const block = blockFromPlacement(
      placement,
      top,
      windowEnd,
      changedByAddress,
      map,
      pxPerByte,
      frame.verified ? frame.base : null,
    );
    blocks.push(block);
    knownRanges.push({ start: placement.start, end: placement.end });
  }

  const unknown = frameUnknownBlocks(frame, top, knownRanges, map, windowEnd, pxPerByte);
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

  // A frame's variable list only asserts ownership the evidence supports:
  // level claim and address range must agree (verified assignments).
  const variables = own
    .filter((placement) => placement.assignment === "verified")
    .map((placement) => placement.node);
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
  placed: VariablePlacementBase[],
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
