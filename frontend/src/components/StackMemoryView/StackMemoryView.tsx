import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import {
  addBytes,
  addressInWindow,
  compareAddress,
  normalizeAddress,
  offsetWithinRow,
} from "../../lib/address";
import { changedBytesMap, markersForRow } from "../../lib/snapshot";
import { useDebugStore } from "../../stores/debugStore";
import type { StackRow } from "../../types/debug";
import { Panel } from "../common/Panel";

const STACK_GRID =
  "grid-cols-[8.7rem_repeat(8,1.55rem)_minmax(7.8rem,1fr)_minmax(4.2rem,0.65fr)_minmax(5.5rem,0.75fr)]";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function ByteCell({
  address,
  byte,
  markerKinds,
  changedBefore,
  changedAfter,
  selected,
  animationsEnabled,
  onSelect,
}: {
  address: string;
  byte: string | null;
  markerKinds: string[];
  changedBefore?: string | null;
  changedAfter?: string | null;
  selected: boolean;
  animationsEnabled: boolean;
  onSelect: (address: string) => void;
}) {
  const changed = changedBefore !== undefined || changedAfter !== undefined;
  const unreadable = byte === null;
  const markerTitle = markerKinds.length ? ` · ${markerKinds.join("/")}` : "";
  const changeTitle = changed
    ? ` · changed ${changedBefore ?? "unknown"} → ${changedAfter ?? "unreadable"}`
    : "";
  return (
    <button
      type="button"
      data-testid="byte-cell"
      data-address={address}
      data-changed={changed ? "true" : "false"}
      data-unreadable={unreadable ? "true" : "false"}
      data-markers={markerKinds.join(",")}
      onClick={() => onSelect(address)}
      title={`${address}: byte ${byte ?? "unreadable"}${markerTitle}${changeTitle}`}
      aria-label={`Address ${address}, byte ${byte ?? "unreadable"}${markerTitle}${changeTitle}`}
      className={`relative h-[18px] border border-[#1a2634] bg-[#0b111a] text-center font-mono text-[9px] leading-[16px] transition-colors ${
        unreadable ? "byte-cell-unreadable text-[#7b6570]" : "text-[#b8c5d3] hover:border-[#4c6078] hover:bg-[#111c28]"
      } ${
        changed
          ? animationsEnabled
            ? "byte-cell-changed"
            : "byte-cell-changed-static"
          : ""
      } ${markerKinds.includes("RSP") ? "byte-cell-rsp" : ""} ${
        markerKinds.includes("RBP") ? "byte-cell-rbp" : ""
      } ${selected ? "outline outline-1 -outline-offset-1 outline-amber-400" : ""}`}
    >
      {byte ?? "--"}
      {changed ? (
        <span aria-hidden="true" className="absolute right-px top-px font-mono text-[7px] leading-none text-emerald-300/90">
          Δ
        </span>
      ) : null}
    </button>
  );
}

function StackRowView({
  row,
  rsp,
  rbp,
  changed,
  selectedAddress,
  animationsEnabled,
  onSelect,
}: {
  row: StackRow;
  rsp: string | null;
  rbp: string | null;
  changed: ReturnType<typeof changedBytesMap>;
  selectedAddress: string | null;
  animationsEnabled: boolean;
  onSelect: (address: string) => void;
}) {
  const markers = markersForRow(row, rsp, rbp);
  const hasRsp = markers.some((marker) => marker.kind === "RSP");
  const hasRbp = markers.some((marker) => marker.kind === "RBP");
  const changedCount = row.bytes.reduce((count, _cell, index) => {
    const address = addBytes(row.address, index);
    return count + (address && changed.has(address) ? 1 : 0);
  }, 0);
  const rowTone = hasRsp
    ? "border-l-[#f6ad55]/70 bg-[#f6ad55]/[0.025]"
    : hasRbp
      ? "border-l-[#7db8e8]/60 bg-[#7db8e8]/[0.022]"
      : row.readable
        ? "border-l-transparent odd:bg-[#0b1119]"
        : "border-l-[#fb7185]/30 bg-[#130d13]";

  return (
    <div
      data-testid="stack-row"
      data-row-address={row.address}
      data-readable={row.readable ? "true" : "false"}
      className={`grid ${STACK_GRID} h-[22px] min-w-[700px] items-center gap-1 border-b border-l-2 border-b-[#121b26] px-2 font-mono ${rowTone}`}
    >
      <span className="truncate text-[9px] text-[#65778c]" title={row.address}>
        {row.address}
      </span>
      {row.bytes.map((byte, index) => {
        const address = addBytes(row.address, index);
        const change = address ? changed.get(address) : undefined;
        const markerKinds = markers
          .filter((marker) => marker.offset === index)
          .map((marker) => marker.kind);
        return (
          <ByteCell
            key={`${row.address}:${index}`}
            address={address ?? row.address}
            byte={byte}
            markerKinds={markerKinds}
            changedBefore={change ? change.before : undefined}
            changedAfter={change ? change.after : undefined}
            selected={Boolean(address && selectedAddress === address)}
            animationsEnabled={animationsEnabled}
            onSelect={onSelect}
          />
        );
      })}
      <span
        className="truncate text-[9px] text-[#aab8c8]"
        title={row.qword_le ?? "unreadable"}
      >
        {row.qword_le ?? <span className="text-[#b97a86]">unreadable</span>}
      </span>
      <span
        className="truncate text-[9px] text-[#63758a]"
        title={row.ascii ?? "unreadable"}
      >
        {row.ascii ?? <span className="text-[#b97a86]">unreadable</span>}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[8px]">
        {markers.map((marker) => (
          <span
            key={`${marker.kind}-${marker.offset}`}
            className={marker.kind === "RSP" ? "text-[#f6ad55]" : "text-[#7db8e8]"}
            title={`${marker.kind} ${row.address} +${marker.offset}`}
          >
            {marker.kind}
            <span className="opacity-60">+{marker.offset}</span>
          </span>
        ))}
        {changedCount > 0 ? (
          <span className="text-emerald-300/90" title={`${changedCount} changed byte(s) this row`}>
            Δ{changedCount}
            <span className="sr-only"> changed</span>
          </span>
        ) : null}
        {!row.readable ? <span className="text-[#b97a86]">unknown</span> : null}
      </span>
    </div>
  );
}

export function StackMemoryView() {
  const snapshot = useDebugStore((state) => state.snapshot);
  const session = useDebugStore((state) => state.session);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const selectedByteAddress = useDebugStore((state) => state.selectedByteAddress);
  const selectByte = useDebugStore((state) => state.selectByte);
  const animationsEnabled = useDebugStore((state) => state.animationsEnabled);
  const scrollTarget = useDebugStore((state) => state.scrollTarget);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rsp = normalizeAddress(snapshot?.registers.rsp ?? null);
  const rbp = normalizeAddress(snapshot?.registers.rbp ?? null);
  const previousRsp = normalizeAddress(previousSnapshot?.registers.rsp ?? null);
  const rangeStart = normalizeAddress(snapshot?.stack.range_start ?? null);
  const rangeEnd = normalizeAddress(snapshot?.stack.range_end ?? null);
  const selectedAddress = normalizeAddress(selectedByteAddress);
  const changed = useMemo(() => changedBytesMap(snapshot), [snapshot]);
  const rows = useMemo(
    () =>
      snapshot
        ? [...snapshot.stack.rows].sort((left, right) =>
            compareAddress(right.address, left.address),
          )
        : [],
    [snapshot],
  );
  const centeredRsp = useRef<string | null>(null);

  const scrollToAddress = useCallback(
    (address: string | null): boolean => {
      const container = scrollRef.current;
      if (!address || !container || !snapshot) return false;
      if (container.clientHeight < 1) return false;
      const row = snapshot.stack.rows.find(
        (candidate) => offsetWithinRow(candidate.address, address) !== null,
      );
      if (!row) return false;
      const element = container.querySelector(`[data-row-address="${row.address}"]`);
      if (!(element instanceof HTMLElement)) return false;
      const top =
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTo({
        top: Math.max(0, top - container.clientHeight / 2 + element.clientHeight / 2),
        behavior: animationsEnabled && !prefersReducedMotion() ? "smooth" : "auto",
      });
      return true;
    },
    [snapshot, animationsEnabled],
  );

  // Center RSP after layout has a real height. A first-frame pass is not
  // enough in headless/narrow windows: the scroll container can still be 0px
  // tall and would otherwise never retry.
  useLayoutEffect(() => {
    if (!snapshot) {
      centeredRsp.current = null;
      return;
    }
    if (!rsp || centeredRsp.current === rsp) return;
    const frame = window.requestAnimationFrame(() => {
      if (scrollToAddress(rsp)) centeredRsp.current = rsp;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [snapshot, rsp, previousRsp, scrollToAddress]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !rsp) return;
    const observer = new ResizeObserver(() => {
      if (centeredRsp.current === rsp) return;
      if (scrollToAddress(rsp)) centeredRsp.current = rsp;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [rsp, scrollToAddress]);

  const rspInView = addressInWindow(rsp, rangeStart, rangeEnd);
  const rbpInView = addressInWindow(rbp, rangeStart, rangeEnd);
  const unreadableRanges = snapshot?.stack.unreadable_ranges ?? [];

  useEffect(() => {
    if (!scrollTarget) return;
    scrollToAddress(scrollTarget.address);
  }, [scrollTarget, scrollToAddress]);

  return (
    <Panel
      title="Stack memory"
      hint="RSP-centred window · high address on top"
      className="min-w-0"
      actions={
        <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#6c7d91]">
          {snapshot ? `${snapshot.stack.rows.length} rows` : "no snapshot"}
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="stack-canvas">
        <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-b border-[#1a2431] bg-[#0a0f15] px-2.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[#5f7085]">
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 border border-[#f6ad55] bg-[#f6ad55]/15" aria-hidden="true" />
            RSP
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 border border-[#7db8e8] bg-[#7db8e8]/15" aria-hidden="true" />
            RBP
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="text-emerald-300">Δ</span> changed
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 border border-dashed border-[#b97a86] bg-[#b97a86]/10" aria-hidden="true" />
            unreadable
          </span>
          <span className="ml-auto hidden truncate text-[#4d5e72] xl:block">
            {rangeStart && rangeEnd ? `${rangeStart} .. ${rangeEnd}` : "no stack window"}
          </span>
        </div>

        {!snapshot ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="border border-[#2a394c] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#76889c]">
              {session ? "waiting for stopped snapshot" : "no live session"}
            </span>
            <p className="max-w-md text-[10px] leading-4 text-[#617186]">
              Launch a teaching sample from the toolbar. Rows are rendered only from a real GDB
              snapshot; unreadable bytes stay <span className="font-mono">--</span>, never zero.
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-4 shrink-0 items-center justify-between px-3 font-mono text-[8px] uppercase tracking-[0.18em] text-[#4f6074]">
              <span data-testid="high-address">HIGH ADDRESS</span>
              <span className="hidden text-[#3f4f61] sm:block">8 bytes / row · little-endian</span>
            </div>

            {rsp && !rspInView ? (
              <div className="mx-2 mb-1 border-l-2 border-[#f6ad55]/70 bg-[#f6ad55]/[0.045] px-2 py-1 font-mono text-[9px] text-[#e7b878]">
                RSP {rsp} is outside the current stack window
              </div>
            ) : null}
            {rbp && !rbpInView ? (
              <div className="mx-2 mb-1 border-l-2 border-[#7db8e8]/60 bg-[#7db8e8]/[0.04] px-2 py-1 font-mono text-[9px] text-[#a9c9e3]">
                RBP {rbp} is outside the current stack window
              </div>
            ) : null}
            {unreadableRanges.length > 0 ? (
              <div className="mx-2 mb-1 border-l-2 border-[#fb7185]/40 bg-[#fb7185]/[0.035] px-2 py-1 font-mono text-[9px] text-[#d69aa4]">
                {unreadableRanges.length} unreadable range(s) · marked unknown, not zero
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
              <div
                className={`sticky top-0 z-10 grid ${STACK_GRID} h-6 min-w-[700px] items-center gap-1 border-b border-[#1a2431] bg-[#0a0f15] px-2 font-mono text-[8px] uppercase tracking-[0.08em] text-[#526477]`}
              >
                <span>address</span>
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index} className="text-center">
                    +{index}
                  </span>
                ))}
                <span>qword / le</span>
                <span>ascii</span>
                <span>markers</span>
              </div>
              {rows.map((row) => (
                <StackRowView
                  key={row.address}
                  row={row}
                  rsp={rsp}
                  rbp={rbp}
                  changed={changed}
                  selectedAddress={selectedAddress}
                  animationsEnabled={animationsEnabled}
                  onSelect={selectByte}
                />
              ))}
              <div className="h-10" aria-hidden="true" />
            </div>

            <div className="flex h-4 shrink-0 items-center justify-between px-3 font-mono text-[8px] uppercase tracking-[0.18em] text-[#4f6074]">
              <span data-testid="low-address">LOW ADDRESS</span>
              <span className="hidden text-[#3f4f61] sm:block">stack grows downward ↓</span>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
