import {
  Profiler,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  addBytes,
  addressInWindow,
  compareAddress,
  normalizeAddress,
  offsetWithinRow,
  parseAddress,
} from "../../lib/address";
import { recordStackRender } from "../../lib/renderPerf";
import { changedBytesMap, markersForRow } from "../../lib/snapshot";
import { ROW_HEIGHT_PX, computeVirtualWindow } from "../../lib/virtualWindow";
import { useDebugStore } from "../../stores/debugStore";
import type { MemoryChange, StackRow } from "../../types/debug";
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

// ---------------------------------------------------------------------------
// Row models: one pass per snapshot, then every row is a set of primitives so
// memoised rows can skip work when their bytes/markers/selection did not change.
// ---------------------------------------------------------------------------
interface StackRowModel {
  row: StackRow;
  bytesSignature: string;
  changedSignature: string;
  changedByOffset: Record<number, { before: string | null; after: string | null }>;
  markerRsp: number | null;
  markerRbp: number | null;
  selectedOffset: number | null;
}

function buildRowModel(
  row: StackRow,
  changed: Map<string, MemoryChange>,
  rsp: string | null,
  rbp: string | null,
  selectedAddress: string | null,
): StackRowModel {
  const markers = markersForRow(row, rsp, rbp);
  const markerRsp = markers.find((marker) => marker.kind === "RSP")?.offset ?? null;
  const markerRbp = markers.find((marker) => marker.kind === "RBP")?.offset ?? null;
  const changedByOffset: Record<
    number,
    { before: string | null; after: string | null }
  > = {};
  const changedParts: string[] = [];
  for (let offset = 0; offset < row.bytes.length; offset += 1) {
    const address = addBytes(row.address, offset);
    if (!address) continue;
    const change = changed.get(address);
    if (!change) continue;
    changedByOffset[offset] = { before: change.before, after: change.after };
    changedParts.push(`${offset}:${change.before ?? ""}:${change.after ?? ""}`);
  }
  return {
    row,
    bytesSignature: row.bytes.join(","),
    changedSignature: changedParts.join("|"),
    changedByOffset,
    markerRsp,
    markerRbp,
    selectedOffset: selectedAddress
      ? offsetWithinRow(row.address, selectedAddress)
      : null,
  };
}

// ---------------------------------------------------------------------------
// ByteCell: primitives only, so React.memo's default shallow compare works.
// ---------------------------------------------------------------------------
interface ByteCellProps {
  address: string;
  byte: string | null;
  markerKinds: string;
  changedBefore: string | null;
  changedAfter: string | null;
  hasChange: boolean;
  selected: boolean;
  animationsEnabled: boolean;
  onSelect: (address: string) => void;
}

const ByteCell = memo(function ByteCell({
  address,
  byte,
  markerKinds,
  changedBefore,
  changedAfter,
  hasChange,
  selected,
  animationsEnabled,
  onSelect,
}: ByteCellProps) {
  const { t } = useTranslation(["panels", "common"]);
  const unreadable = byte === null;
  const markerTitle = markerKinds ? t("panels:stack.markerSuffix", { markers: markerKinds }) : "";
  const changeTitle = hasChange
    ? t("panels:stack.changeSuffix", {
        before: changedBefore ?? t("common:unknown"),
        after: changedAfter ?? t("common:unreadable"),
      })
    : "";
  const title = unreadable
    ? t("panels:stack.byteTitleUnreadable", { address })
    : t("panels:stack.byteTitle", { address, byte });
  return (
    <button
      type="button"
      data-testid="byte-cell"
      data-address={address}
      data-changed={hasChange ? "true" : "false"}
      data-unreadable={unreadable ? "true" : "false"}
      data-markers={markerKinds}
      data-selected={selected ? "true" : "false"}
      onClick={() => onSelect(address)}
      title={`${title}${markerTitle}${changeTitle}`}
      aria-label={`${t("panels:stack.byteAria", {
        address,
        byte: byte ?? t("common:unreadable"),
      })}${markerTitle}${changeTitle}`}
      className={`relative h-[18px] border border-[#1a2634] bg-[#0b111a] text-center font-mono text-[9px] leading-[16px] transition-colors ${
        unreadable
          ? "byte-cell-unreadable text-[#7b6570]"
          : "text-[#b8c5d3] hover:border-[#4c6078] hover:bg-[#111c28]"
      } ${
        hasChange
          ? animationsEnabled
            ? "byte-cell-changed"
            : "byte-cell-changed-static"
          : ""
      } ${markerKinds.includes("RSP") ? "byte-cell-rsp" : ""} ${
        markerKinds.includes("RBP") ? "byte-cell-rbp" : ""
      } ${selected ? "outline outline-1 -outline-offset-1 outline-amber-400" : ""}`}
    >
      {byte ?? "--"}
      {hasChange ? (
        <span
          aria-hidden="true"
          className="absolute right-px top-px font-mono text-[7px] leading-none text-emerald-300/90"
        >
          螖
        </span>
      ) : null}
    </button>
  );
});

// ---------------------------------------------------------------------------
// StackRowView: custom comparator over the model's primitives, because the
// snapshot JSON produces a fresh `row` object on every update.
// ---------------------------------------------------------------------------
interface StackRowViewProps {
  model: StackRowModel;
  selectedAddress: string | null;
  animationsEnabled: boolean;
  onSelect: (address: string) => void;
}

function StackRowViewImpl({
  model,
  animationsEnabled,
  onSelect,
}: StackRowViewProps) {
  const { t } = useTranslation(["panels", "common"]);
  const { row, changedByOffset, markerRsp, markerRbp, selectedOffset } = model;
  const hasRsp = markerRsp !== null;
  const hasRbp = markerRbp !== null;
  const changedCount = Object.keys(changedByOffset).length;
  const rowTone = hasRsp
    ? "border-l-[#f6ad55]/70 bg-[#f6ad55]/[0.025]"
    : hasRbp
      ? "border-l-[#7db8e8]/60 bg-[#7db8e8]/[0.022]"
      : row.readable
        ? "border-l-transparent odd:bg-[#0b1119]"
        : "border-l-[#fb7185]/30 bg-[#130d13]";

  const markers: Array<{ kind: "RSP" | "RBP"; offset: number }> = [];
  if (markerRsp !== null) markers.push({ kind: "RSP", offset: markerRsp });
  if (markerRbp !== null) markers.push({ kind: "RBP", offset: markerRbp });

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
        const address = addBytes(row.address, index) ?? row.address;
        const change = changedByOffset[index];
        const markerKinds = markers
          .filter((marker) => marker.offset === index)
          .map((marker) => marker.kind)
          .join(",");
        return (
          <ByteCell
            key={`${row.address}:${index}`}
            address={address}
            byte={byte}
            markerKinds={markerKinds}
            hasChange={Boolean(change)}
            changedBefore={change ? change.before : null}
            changedAfter={change ? change.after : null}
            selected={selectedOffset === index}
            animationsEnabled={animationsEnabled}
            onSelect={onSelect}
          />
        );
      })}
      <span
        className="truncate text-[9px] text-[#aab8c8]"
        title={row.qword_le ?? t("common:unreadable")}
      >
        {row.qword_le ?? (
          <span className="text-[#b97a86]">{t("common:unreadable")}</span>
        )}
      </span>
      <span
        className="truncate text-[9px] text-[#63758a]"
        title={row.ascii ?? t("common:unreadable")}
      >
        {row.ascii ?? <span className="text-[#b97a86]">{t("common:unreadable")}</span>}
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
          <span
            className="text-emerald-300/90"
            title={t("panels:stack.changedCountTitle", { count: changedCount })}
          >
            螖{changedCount}
            <span className="sr-only"> {t("common:changed")}</span>
          </span>
        ) : null}
        {!row.readable ? (
          <span className="text-[#b97a86]">{t("panels:stack.rowUnknown")}</span>
        ) : null}
      </span>
    </div>
  );
}

const StackRowView = memo(StackRowViewImpl, (previous, next) => {
  const left = previous.model;
  const right = next.model;
  return (
    left.row.address === right.row.address &&
    left.bytesSignature === right.bytesSignature &&
    left.changedSignature === right.changedSignature &&
    left.markerRsp === right.markerRsp &&
    left.markerRbp === right.markerRbp &&
    left.row.qword_le === right.row.qword_le &&
    left.row.ascii === right.row.ascii &&
    left.row.readable === right.row.readable &&
    left.selectedOffset === right.selectedOffset &&
    previous.selectedAddress === next.selectedAddress &&
    previous.animationsEnabled === next.animationsEnabled &&
    previous.onSelect === next.onSelect
  );
});

// ---------------------------------------------------------------------------

function rowIndexForAddress(
  rangeStart: string | null,
  rangeEnd: string | null,
  rowCount: number,
  address: string,
): number | null {
  const start = parseAddress(rangeStart);
  const end = parseAddress(rangeEnd);
  const target = parseAddress(address);
  if (start === null || end === null || target === null) return null;
  if (target < start || target >= end) return null;
  const fromLow = Number((target - start) / 8n);
  if (!Number.isFinite(fromLow) || fromLow < 0 || fromLow >= rowCount) return null;
  // Rows are rendered high address first.
  return rowCount - 1 - fromLow;
}

export const StackMemoryView = memo(function StackMemoryView() {
  const { t } = useTranslation(["panels", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  // A boolean keeps this panel from re-rendering on every session metadata
  // change (pids, snapshot_count) that does not affect the canvas.
  const hasSession = useDebugStore((state) => state.session !== null);
  const selectedByteAddress = useDebugStore((state) => state.selectedByteAddress);
  const selectByte = useDebugStore((state) => state.selectByte);
  const animationsEnabled = useDebugStore((state) => state.animationsEnabled);
  const scrollTarget = useDebugStore((state) => state.scrollTarget);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  const rsp = normalizeAddress(snapshot?.registers.rsp ?? null);
  const rbp = normalizeAddress(snapshot?.registers.rbp ?? null);
  const rangeStart = normalizeAddress(snapshot?.stack.range_start ?? null);
  const rangeEnd = normalizeAddress(snapshot?.stack.range_end ?? null);
  const selectedAddress = normalizeAddress(selectedByteAddress);

  const rows = useMemo(
    () =>
      snapshot
        ? [...snapshot.stack.rows].sort((left, right) =>
            compareAddress(right.address, left.address),
          )
        : [],
    [snapshot],
  );

  const changed = useMemo(() => changedBytesMap(snapshot), [snapshot]);

  const rowModels = useMemo(
    () =>
      rows.map((row) =>
        buildRowModel(row, changed, rsp, rbp, selectedAddress),
      ),
    [rows, changed, rsp, rbp, selectedAddress],
  );

  const virtual = useMemo(
    () => computeVirtualWindow(rowModels.length, viewport.top, viewport.height),
    [rowModels.length, viewport.top, viewport.height],
  );

  const visibleRows = virtual.enabled
    ? rowModels.slice(virtual.start, virtual.end)
    : rowModels;

  const centeredRsp = useRef<string | null>(null);
  const scrollFrame = useRef<number | null>(null);

  const scrollToAddress = useCallback(
    (address: string | null): boolean => {
      const container = scrollRef.current;
      if (!address || !container || !snapshot) return false;
      if (container.clientHeight < 1) return false;
      const index = rowIndexForAddress(rangeStart, rangeEnd, rowModels.length, address);
      if (index === null) return false;
      let top: number;
      if (virtual.enabled) {
        top = index * ROW_HEIGHT_PX - container.clientHeight / 2 + ROW_HEIGHT_PX / 2;
      } else {
        const rowAddress = rowModels[index]?.row.address;
        if (!rowAddress) return false;
        const element = container.querySelector(
          `[data-row-address="${rowAddress}"]`,
        );
        if (!(element instanceof HTMLElement)) return false;
        top =
          element.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop -
          container.clientHeight / 2 +
          element.clientHeight / 2;
      }
      const target = Math.max(0, top);
      const smooth =
        animationsEnabled &&
        !prefersReducedMotion() &&
        typeof document !== "undefined" &&
        document.visibilityState === "visible";
      container.scrollTo({
        top: target,
        behavior: smooth ? "smooth" : "auto",
      });
      if (smooth) {
        // Some environments (headless/no compositor, heavily throttled tabs)        // let a smooth scroll creep a few pixels and then stall forever. Detect
        // a stall (position stops moving while the target is still far away)
        // and jump directly so RSP/RBP navigation never appears dead.
        const startedAt = performance.now();
        let previous = container.scrollTop;
        const watchdog = () => {
          if (!container.isConnected) return;
          const current = container.scrollTop;
          if (Math.abs(current - target) <= 2) return;
          const stalled =
            Math.abs(current - previous) <= 1 && performance.now() - startedAt >= 150;
          if (stalled) {
            container.scrollTop = target;
            return;
          }
          previous = current;
          if (performance.now() - startedAt < 2000) {
            window.setTimeout(watchdog, 120);
          }
        };
        window.setTimeout(watchdog, 160);
      }
      if (virtual.enabled) {
        setViewport((current) =>
          current.top === target ? current : { ...current, top: target },
        );
      }
      return true;
    },
    [
      snapshot,
      rangeStart,
      rangeEnd,
      rowModels,
      virtual.enabled,
      animationsEnabled,
    ],
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
  }, [snapshot, rsp, scrollToAddress]);

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

  // Virtualisation only: keep the window in sync with the real scroll position.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !virtual.enabled) return;
    const sync = () => {
      setViewport((current) =>
        current.top === container.scrollTop &&
        current.height === container.clientHeight
          ? current
          : { top: container.scrollTop, height: container.clientHeight },
      );
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    return () => observer.disconnect();
  }, [virtual.enabled]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    },
    [],
  );

  const handleScroll = useCallback(() => {
    if (!virtual.enabled) return;
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const container = scrollRef.current;
      if (!container) return;
      setViewport((current) =>
        current.top === container.scrollTop
          ? current
          : { ...current, top: container.scrollTop },
      );
    });
  }, [virtual.enabled]);

  const rspInView = addressInWindow(rsp, rangeStart, rangeEnd);
  const rbpInView = addressInWindow(rbp, rangeStart, rangeEnd);
  const unreadableRanges = snapshot?.stack.unreadable_ranges ?? [];

  useEffect(() => {
    if (!scrollTarget) return;
    scrollToAddress(scrollTarget.address);
  }, [scrollTarget, scrollToAddress]);

  return (
    <Panel
      title={t("panels:stack.title")}
      hint={t("panels:stack.hint")}
      className="min-w-0"
      actions={
        <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#6c7d91]">
          {snapshot
            ? t("common:rowCount", { count: snapshot.stack.rows.length })
            : t("panels:stack.noSnapshot")}
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
            <span className="text-emerald-300">螖</span> {t("panels:stack.legendChanged")}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 border border-dashed border-[#b97a86] bg-[#b97a86]/10" aria-hidden="true" />
            {t("panels:stack.legendUnreadable")}
          </span>
          <span className="ml-auto hidden truncate text-[#4d5e72] xl:block">
            {rangeStart && rangeEnd
              ? `${rangeStart} .. ${rangeEnd}`
              : t("panels:stack.noWindow")}
          </span>
        </div>

        {!snapshot ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="border border-[#2a394c] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#76889c]">
              {hasSession
                ? t("panels:stack.waiting")
                : t("panels:stack.noSession")}
            </span>
            <p className="max-w-md text-[10px] leading-4 text-[#617186]">
              {t("panels:stack.emptyBody")}
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-4 shrink-0 items-center justify-between px-3 font-mono text-[8px] uppercase tracking-[0.18em] text-[#4f6074]">
              <span data-testid="high-address">{t("panels:stack.high")}</span>
              <span className="hidden text-[#3f4f61] sm:block">
                {t("panels:stack.layout")}
              </span>
            </div>

            {rsp && !rspInView ? (
              <div className="mx-2 mb-1 border-l-2 border-[#f6ad55]/70 bg-[#f6ad55]/[0.045] px-2 py-1 font-mono text-[9px] text-[#e7b878]">
                {t("panels:stack.rspOutside", { address: rsp })}
              </div>
            ) : null}
            {rbp && !rbpInView ? (
              <div className="mx-2 mb-1 border-l-2 border-[#7db8e8]/60 bg-[#7db8e8]/[0.04] px-2 py-1 font-mono text-[9px] text-[#a9c9e3]">
                {t("panels:stack.rbpOutside", { address: rbp })}
              </div>
            ) : null}
            {unreadableRanges.length > 0 ? (
              <div className="mx-2 mb-1 border-l-2 border-[#fb7185]/40 bg-[#fb7185]/[0.035] px-2 py-1 font-mono text-[9px] text-[#d69aa4]">
                {t("panels:stack.unreadableRanges", {
                  count: unreadableRanges.length,
                })}
              </div>
            ) : null}

            <div
              className="min-h-0 flex-1 overflow-auto"
              ref={scrollRef}
              onScroll={handleScroll}
              data-virtualized={virtual.enabled ? "true" : "false"}
              data-testid="stack-scroll"
            >
              <div
                className={`sticky top-0 z-10 grid ${STACK_GRID} h-6 min-w-[700px] items-center gap-1 border-b border-[#1a2431] bg-[#0a0f15] px-2 font-mono text-[8px] uppercase tracking-[0.08em] text-[#526477]`}
              >
                <span>{t("panels:stack.colAddress")}</span>
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index} className="text-center">
                    +{index}
                  </span>
                ))}
                <span>{t("panels:stack.colQword")}</span>
                <span>{t("panels:stack.colAscii")}</span>
                <span>{t("panels:stack.colMarkers")}</span>
              </div>
              <Profiler id="StackMemoryView" onRender={recordStackRender}>
                {virtual.enabled && virtual.paddingTop > 0 ? (
                  <div style={{ height: virtual.paddingTop }} aria-hidden="true" />
                ) : null}
                {visibleRows.map((model) => (
                  <StackRowView
                    key={model.row.address}
                    model={model}
                    selectedAddress={selectedAddress}
                    animationsEnabled={animationsEnabled}
                    onSelect={selectByte}
                  />
                ))}
                {virtual.enabled && virtual.paddingBottom > 0 ? (
                  <div style={{ height: virtual.paddingBottom }} aria-hidden="true" />
                ) : null}
              </Profiler>
              <div className="h-10" aria-hidden="true" />
            </div>

            <div className="flex h-4 shrink-0 items-center justify-between px-3 font-mono text-[8px] uppercase tracking-[0.18em] text-[#4f6074]">
              <span data-testid="low-address">{t("panels:stack.low")}</span>
              <span className="hidden text-[#3f4f61] sm:block">
                {t("panels:stack.growsDown")}
              </span>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
});
