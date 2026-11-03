import { useCallback, useEffect, useMemo, useRef } from "react";

import { addBytes, addressInWindow, compareAddress, normalizeAddress, offsetWithinRow } from "../../lib/address";
import { changedBytesMap, markersForRow } from "../../lib/snapshot";
import { useDebugStore } from "../../stores/debugStore";
import type { StackRow } from "../../types/debug";
import { Panel } from "../common/Panel";
import { StatusBadge } from "../common/StatusBadge";

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
      className={`relative h-6 rounded-sm border px-0.5 text-center font-mono text-[10px] leading-5 transition-colors ${
        unreadable
          ? "byte-cell-unreadable text-slate-600"
          : "border-[#1b2534] bg-[#0b111a] text-slate-300 hover:border-slate-500"
      } ${
        changed
          ? animationsEnabled
            ? "byte-cell-changed"
            : "byte-cell-changed-static"
          : ""
      } ${markerKinds.includes("RSP") ? "byte-cell-rsp" : ""} ${
        markerKinds.includes("RBP") ? "byte-cell-rbp" : ""
      } ${selected ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-[#0d1117]" : ""}`}
    >
      {byte ?? "--"}
      {changed ? (
        <span aria-hidden="true" className="absolute -right-0.5 -top-1 text-[8px] text-emerald-300">
          Δ
        </span>
      ) : null}
      {markerKinds.length > 0 ? (
        <span
          aria-hidden="true"
          className={`absolute -bottom-1 left-0 right-0 text-center text-[7px] leading-none ${
            markerKinds.includes("RSP") ? "text-orange-300" : "text-sky-300"
          }`}
        >
          {markerKinds.join("/")}
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
  const markerLabel = markers.map((marker) => `${marker.kind}+${marker.offset}`).join(" ");
  const changedCount = row.bytes.reduce((count, _cell, index) => {
    const address = addBytes(row.address, index);
    return count + (address && changed.has(address) ? 1 : 0);
  }, 0);
  const rowClasses = row.readable
    ? "border-[#141b26] odd:bg-[#0f141d]"
    : "border-[#2a1f2e] bg-[#160f18]";

  return (
    <div
      data-testid="stack-row"
      data-row-address={row.address}
      data-readable={row.readable ? "true" : "false"}
      className={`grid min-w-[720px] grid-cols-[9.2rem_repeat(8,1.7rem)_minmax(8.5rem,1fr)_minmax(5rem,0.8fr)_minmax(7.5rem,1fr)] items-center gap-1 border-b px-2 py-0.5 ${rowClasses}`}
    >
      <span className="font-mono text-[10px] text-slate-500" title={row.address}>
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
      <span className="truncate font-mono text-[10px] text-slate-300" title={row.qword_le ?? "unreadable"}>
        {row.qword_le ?? <span className="text-rose-300/70">unreadable</span>}
      </span>
      <span className="truncate font-mono text-[10px] text-slate-500" title={row.ascii ?? "unreadable"}>
        {row.ascii ?? <span className="text-rose-300/70">unreadable</span>}
      </span>
      <span className="flex flex-wrap items-center gap-1 font-mono text-[9px] text-slate-600">
        {markerLabel ? (
          <span className="text-orange-300/90">{markerLabel}</span>
        ) : null}
        {changedCount > 0 ? (
          <span className="text-emerald-300/90">changed {changedCount}</span>
        ) : null}
        {!row.readable ? <span className="text-rose-300/80">unknown</span> : null}
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
    (address: string | null) => {
      if (!address || !scrollRef.current || !snapshot) return;
      const row = snapshot.stack.rows.find(
        (candidate) => offsetWithinRow(candidate.address, address) !== null,
      );
      if (!row) return;
      const element = scrollRef.current.querySelector(
        `[data-row-address="${row.address}"]`,
      );
      if (element instanceof HTMLElement) {
        element.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: animationsEnabled ? "smooth" : "auto",
        });
      }
    },
    [snapshot, animationsEnabled],
  );

  // Center RSP on first snapshot and whenever RSP actually moves. This keeps the
  // orange RSP marker visible without fighting a user who is browsing elsewhere
  // while RSP is unchanged.
  useEffect(() => {
    if (!snapshot) {
      centeredRsp.current = null;
      return;
    }
    if (!rsp) return;
    if (centeredRsp.current === null || rsp !== centeredRsp.current) {
      centeredRsp.current = rsp;
      scrollToAddress(rsp);
    }
  }, [snapshot, rsp, previousRsp, scrollToAddress]);

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
      hint="high address on top · stack grows downward"
      className="min-w-0"
      actions={
        <StatusBadge tone={snapshot ? "ok" : "idle"}>
          {snapshot ? `${snapshot.stack.rows.length} rows` : "no snapshot"}
        </StatusBadge>
      }
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="stack-canvas">
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#1e2635] px-3 py-1.5 font-mono text-[9px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm border border-orange-400 bg-orange-500/20" />
            RSP marker
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm border border-sky-400 bg-sky-500/20" />
            RBP marker
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-emerald-300">Δ</span>
            changed byte
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm border border-rose-400/60 bg-rose-500/10" />
            unknown / unreadable
          </span>
          <span className="ml-auto text-slate-600">
            {rangeStart && rangeEnd ? `${rangeStart} .. ${rangeEnd}` : "no stack window"}
          </span>
        </div>

        {!snapshot ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <StatusBadge tone={session ? "warn" : "idle"}>
              {session ? "waiting for stopped snapshot" : "no live session"}
            </StatusBadge>
            <p className="max-w-md text-[11px] leading-5 text-slate-500">
              Launch a teaching sample from the toolbar. Rows are only rendered from a real
              GDB snapshot; unreadable bytes are shown as <span className="font-mono">--</span>,
              never as zero.
            </p>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">
              <span data-testid="high-address">HIGH ADDRESS</span>
              <span className="text-slate-700">8 bytes / row · little-endian</span>
            </div>

            {rsp && !rspInView ? (
              <div className="mx-3 mb-1 rounded border border-orange-500/30 bg-orange-500/5 px-2 py-1 font-mono text-[10px] text-orange-200/80">
                RSP {rsp} is outside the current stack window
              </div>
            ) : null}
            {rbp && !rbpInView ? (
              <div className="mx-3 mb-1 rounded border border-sky-500/30 bg-sky-500/5 px-2 py-1 font-mono text-[10px] text-sky-200/80">
                RBP {rbp} is outside the current stack window
              </div>
            ) : null}
            {unreadableRanges.length > 0 ? (
              <div className="mx-3 mb-1 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 font-mono text-[10px] text-rose-200/80">
                {unreadableRanges.length} unreadable range(s) in this window — marked unknown, not zero
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
              <div className="grid min-w-[720px] grid-cols-[9.2rem_repeat(8,1.7rem)_minmax(8.5rem,1fr)_minmax(5rem,0.8fr)_minmax(7.5rem,1fr)] gap-1 border-b border-[#1e2635] bg-[#0a0e14] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-slate-600">
                <span>address</span>
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index} className="text-center">
                    +{index}
                  </span>
                ))}
                <span>qword (le)</span>
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
            </div>

            <div className="flex shrink-0 items-center justify-between px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">
              <span data-testid="low-address">LOW ADDRESS</span>
              <span className="text-slate-700">stack grows downward ↓</span>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
