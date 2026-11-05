import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import {
  STACK_MAP_FRAME_LABEL_WIDTH,
  STACK_MAP_POINTER_LANE,
  STACK_MAP_RULER_WIDTH,
  addressTop,
  blockForAddress,
  buildStackMap,
  type PointerLink,
  type StackMapBlock,
  type StackMapModel,
} from "../../lib/stackMap";
import { useDebugStore } from "../../stores/debugStore";
import { AddressRuler } from "./AddressRuler";
import { MemoryBlock } from "./MemoryBlock";
import { PointerArrow } from "./PointerArrow";
import { StackFrameCard } from "./StackFrameCard";
import { StackPointerMarker } from "./StackPointerMarker";

const MAP_LEFT = STACK_MAP_RULER_WIDTH + STACK_MAP_FRAME_LABEL_WIDTH;

/**
 * Pick the most useful viewport top for a frame.
 *
 * - if the whole frame fits, show it from its top;
 * - otherwise, if the variable blocks fit together, show them (the teaching
 *   content) rather than the frame's bookkeeping slots;
 * - otherwise show the bottom of the frame, where RSP and the live locals are.
 */
export function frameFocusTop(
  frame: {
    top: number;
    height: number;
    blocks: Array<{ kind: string; top: number; height: number }>;
  },
  viewport: number,
): number {
  if (viewport <= 0) return Math.max(0, frame.top - 8);
  if (frame.height + 16 <= viewport) return Math.max(0, frame.top - 8);
  const variables = frame.blocks.filter((block) => block.kind === "variable");
  if (variables.length > 0) {
    const top = Math.min(...variables.map((block) => frame.top + block.top));
    const bottom = Math.max(
      ...variables.map((block) => frame.top + block.top + block.height),
      frame.top + frame.height,
    );
    if (bottom - top + 16 <= viewport) return Math.max(0, top - 8);
  }
  return Math.max(0, frame.top + frame.height - viewport + 8);
}

interface BandCardProps {
  block: StackMapBlock;
  label: string;
  hint: string;
  selectedBlockId: string | null;
  snapshotId: number;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  onSelectBlock: (block: StackMapBlock) => void;
  onHoverBlock: (block: StackMapBlock | null) => void;
  rightInset: number;
}

function BandCard({
  block,
  label,
  hint,
  selectedBlockId,
  snapshotId,
  animationsEnabled,
  reducedMotion,
  onSelectBlock,
  onHoverBlock,
  rightInset,
}: BandCardProps) {
  const localBlock = { ...block, top: 0 };
  return (
    <section
      className="absolute right-0 z-[5] border-l-2 border-[#26384b] border-y border-y-[#162433]/70 bg-[#080e15]/60"
      style={{
        left: STACK_MAP_RULER_WIDTH,
        top: block.top,
        height: Math.max(1, block.height),
      }}
      data-testid="stack-map-band"
      data-kind={block.kind}
    >
      <div
        className="grid h-full"
        style={{ gridTemplateColumns: `${STACK_MAP_FRAME_LABEL_WIDTH}px minmax(0,1fr)` }}
      >
        <div className="flex min-w-0 flex-col gap-1 border-r border-[#162433] bg-[#080e15]/80 p-3">
          <span className="text-[13px] font-medium text-[#7d91a7]">{label}</span>
          <span className="font-mono text-[11.5px] leading-4 text-[#5a6d82]">{hint}</span>
        </div>
        <div className="relative min-w-0">
          <MemoryBlock
            block={localBlock}
            pointerLink={null}
            targetLabel={null}
            selected={selectedBlockId === block.id}
            highlighted={false}
            snapshotId={snapshotId}
            animationsEnabled={animationsEnabled}
            reducedMotion={reducedMotion}
            onSelect={onSelectBlock}
            onHover={onHoverBlock}
            onExpandTarget={null}
            showLabel={false}
            rightInset={rightInset}
          />
        </div>
      </div>
    </section>
  );
}

function emptyStateReason(
  reason: StackMapModel["reason"],
  t: (key: string) => string,
): string {
  if (reason === "no-window") return t("panels:stackMap.noWindow");
  if (reason === "no-stack-pointer") return t("panels:stackMap.noStackPointer");
  if (reason === "no-snapshot") return t("panels:stackMap.noSnapshotHint");
  return t("panels:stackMap.noSnapshotHint");
}

/**
 * The presentation-mode stack map.
 *
 * Layout contract:
 *  - horizontal: address ruler | frame label | memory blocks | pointer lane;
 *  - vertical: high address at the top, one pixel run per real byte;
 *  - every block's Y is `addressTop()` of its real end address, so gaps are
 *    exact and consecutive frames meet at the same boundary.
 */
export function StackMapCanvas() {
  const { t } = useTranslation(["panels", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const selectedByteAddress = useDebugStore((state) => state.selectedByteAddress);
  const selectByte = useDebugStore((state) => state.selectByte);
  const requestScroll = useDebugStore((state) => state.requestScroll);
  const jumpToPointer = useDebugStore((state) => state.jumpToPointer);
  const animationsEnabled = useDebugStore((state) => state.animationsEnabled);
  const scrollTarget = useDebugStore((state) => state.scrollTarget);
  const reducedMotion = usePrefersReducedMotion();

  const model = useMemo(() => buildStackMap(snapshot), [snapshot]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [hoveredLinkIds, setHoveredLinkIds] = useState<string[]>([]);
  const hoveredLinkIdSet = useMemo(() => new Set(hoveredLinkIds), [hoveredLinkIds]);

  const selectedBlock = blockForAddress(model, selectedByteAddress);
  const selectedBlockId = selectedBlock?.id ?? null;

  const linksByFrom = useMemo(() => {
    const map = new Map<string, PointerLink[]>();
    for (const link of model.pointerLinks) {
      const existing = map.get(link.fromBlockId);
      if (existing) existing.push(link);
      else map.set(link.fromBlockId, [link]);
    }
    return map;
  }, [model.pointerLinks]);

  const linksByTarget = useMemo(() => {
    const map = new Map<string, PointerLink[]>();
    for (const link of model.pointerLinks) {
      if (!link.targetBlockId) continue;
      const existing = map.get(link.targetBlockId);
      if (existing) existing.push(link);
      else map.set(link.targetBlockId, [link]);
    }
    return map;
  }, [model.pointerLinks]);

  const pointerTargetBlockIds = useMemo(() => {
    const set = new Set<string>();
    for (const link of model.pointerLinks) {
      if (link.targetBlockId) set.add(link.targetBlockId);
    }
    return set;
  }, [model.pointerLinks]);

  const highlightedBlockIds = useMemo(() => {
    const set = new Set<string>();
    if (hoveredBlockId) set.add(hoveredBlockId);
    for (const linkId of hoveredLinkIds) {
      const link = model.pointerLinks.find((entry) => entry.id === linkId);
      if (!link) continue;
      set.add(link.fromBlockId);
      if (link.targetBlockId) set.add(link.targetBlockId);
    }
    return set;
  }, [hoveredBlockId, hoveredLinkIds, model.pointerLinks]);

  const blockGeometry = useMemo(() => {
    const geometry = new Map<string, { top: number; height: number }>();
    for (const frame of model.frames) {
      for (const block of frame.blocks) {
        geometry.set(block.id, { top: frame.top + block.top, height: block.height });
      }
    }
    if (model.belowRsp) {
      geometry.set(model.belowRsp.id, { top: model.belowRsp.top, height: model.belowRsp.height });
    }
    if (model.aboveFrames) {
      geometry.set(model.aboveFrames.id, {
        top: model.aboveFrames.top,
        height: model.aboveFrames.height,
      });
    }
    return geometry;
  }, [model]);

  const renderLinks = useMemo(() => {
    const rendered: Array<{ link: PointerLink; fromTop: number; toTop: number }> = [];
    for (const link of model.pointerLinks) {
      if (link.state === "null" || link.state === "outside-window" || link.state === "unreadable") {
        continue;
      }
      const from = blockGeometry.get(link.fromBlockId);
      if (!from) continue;
      const target = link.targetBlockId ? blockGeometry.get(link.targetBlockId) : null;
      const toTop =
        target !== undefined && target !== null
          ? target.top + target.height / 2
          : addressTop(model, link.targetAddress);
      if (toTop === null) continue;
      rendered.push({
        link,
        fromTop: from.top + from.height / 2,
        toTop,
      });
    }
    return rendered;
  }, [blockGeometry, model]);

  const changedOutsideBlocks = useMemo(
    () =>
      model.changeMarks.filter((mark) => {
        const block = blockForAddress(model, mark.address);
        return block === null || block.kind === "unknown" || block.kind === "unreadable";
      }),
    [model],
  );

  const targetLabelFor = useCallback(
    (link: PointerLink): string | null => {
      if (!link.targetBlockId) return null;
      const target = model.blocks.find((block) => block.id === link.targetBlockId);
      if (!target) return null;
      if (target.variable) return target.variable.name;
      if (target.kind === "saved-rbp") return t("panels:stackMap.savedRbp");
      if (target.kind === "return-address") return t("panels:stackMap.returnAddress");
      return null;
    },
    [model.blocks, t],
  );

  const scrollToPosition = useCallback(
    (top: number, smooth: boolean) => {
      const container = scrollRef.current;
      if (!container) return;
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      const target = Math.max(0, Math.min(max, top));
      const animate = smooth && animationsEnabled && !reducedMotion;
      container.scrollTo({ top: target, behavior: animate ? "smooth" : "auto" });
    },
    [animationsEnabled, reducedMotion],
  );

  const scrollToTop = useCallback(
    (top: number, smooth: boolean) => {
      const container = scrollRef.current;
      if (!container) return;
      scrollToPosition(top - container.clientHeight * 0.55, smooth);
    },
    [scrollToPosition],
  );

  const focusAddress = useCallback(
    (address: string | null) => {
      if (!address) return;
      const top = addressTop(model, address);
      if (top === null) return;
      scrollToTop(top, true);
    },
    [model, scrollToTop],
  );

  const focusFrameByLevel = useCallback(
    (level: number) => {
      const frame = model.frames.find((candidate) => candidate.level === level);
      const container = scrollRef.current;
      if (!frame || !container) return;
      scrollToPosition(frameFocusTop(frame, container.clientHeight), true);
    },
    [model.frames, scrollToPosition],
  );

  const focusFrameTop = useCallback(() => {
    focusFrameByLevel(0);
  }, [focusFrameByLevel]);

  // Keep the current frame's teaching content visible. The key includes the
  // frame bounds and viewport height, so push/pop/step-into/return re-focuses,
  // while ordinary instruction steps inside the same frame never reset scroll.
  const lastFrameKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!model.available) return;
    const frame = model.frames[0] ?? null;
    const container = scrollRef.current;
    const viewport = container?.clientHeight ?? viewportHeight;
    if (!frame || viewport <= 0) return;
    const key = `${frame.level}:${frame.function ?? ""}:${frame.start ?? ""}:${
      frame.end ?? ""
    }:${viewport}`;
    if (lastFrameKey.current === key) return;
    lastFrameKey.current = key;
    scrollToPosition(frameFocusTop(frame, viewport), false);
  }, [model, viewportHeight, scrollToPosition]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const measure = () => setViewportHeight(container.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const lastScrollNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!scrollTarget) return;
    if (lastScrollNonce.current === scrollTarget.nonce) return;
    lastScrollNonce.current = scrollTarget.nonce;
    const top = addressTop(model, scrollTarget.address);
    if (top !== null) scrollToTop(top, true);
  }, [scrollTarget, model, scrollToTop]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      setContentWidth((current) => (Math.abs(current - width) < 0.5 ? current : width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [model.contentHeight]);

  const handleHoverBlock = useCallback(
    (block: StackMapBlock | null) => {
      if (!block) {
        setHoveredBlockId(null);
        setHoveredLinkIds([]);
        return;
      }
      setHoveredBlockId(block.id);
      const outgoing = linksByFrom.get(block.id) ?? [];
      const incoming = linksByTarget.get(block.id) ?? [];
      setHoveredLinkIds([...outgoing, ...incoming].map((link) => link.id));
    },
    [linksByFrom, linksByTarget],
  );

  const handleSelectBlock = useCallback(
    (block: StackMapBlock) => {
      selectByte(block.address);
    },
    [selectByte],
  );

  const handleExpandTarget = useCallback(
    (link: PointerLink) => {
      const fromBlock = model.blocks.find((block) => block.id === link.fromBlockId);
      if (fromBlock?.variable) {
        jumpToPointer(fromBlock.variable);
        return;
      }
      selectByte(link.targetAddress);
      requestScroll(link.targetAddress);
    },
    [model.blocks, jumpToPointer, selectByte, requestScroll],
  );

  const laneWidth = model.pointerLinks.length > 0 ? STACK_MAP_POINTER_LANE : 12;
  const blockRight = contentWidth > 0 ? contentWidth - laneWidth : 0;
  const laneRight = contentWidth > 0 ? contentWidth - 18 : 0;
  const canDrawPointers = contentWidth > MAP_LEFT + 160;
  const focusFrame = model.frames[0] ?? null;
  const snapshotId = snapshot?.snapshot_id ?? 0;
  const changedRegisters = snapshot?.diff.changed_registers ?? [];

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[#1b2a3a] bg-[#070d14]"
      data-testid="stack-map-canvas"
      aria-label={t("panels:stackMap.title")}
    >
      <header className="shrink-0 border-b border-[#1b2a3a] bg-[#0a121b] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-[18px] font-semibold tracking-[0.01em] text-[#edf5fd]">
            {t("panels:stackMap.title")}
          </h2>
          <span className="hidden text-[12.5px] text-[#7f93a8] sm:inline">
            {t("panels:stackMap.hint")}
          </span>
          <span className="rounded-sm border border-[#2b3d51] bg-[#0c1520] px-1.5 py-0.5 font-mono text-[11.5px] text-[#9fb2c6]">
            {t("panels:stackMap.frameCount", { count: model.frames.length })}
          </span>
          {model.changedCount > 0 ? (
            <span
              className="rounded-sm border border-emerald-500/40 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[11.5px] text-emerald-200"
              data-testid="stack-map-changed-count"
            >
              {t("panels:stackMap.changedCount", { count: model.changedCount })}
            </span>
          ) : null}
          {model.unreadableCount > 0 ? (
            <span className="rounded-sm border border-rose-500/35 bg-rose-500/[0.06] px-1.5 py-0.5 text-[11.5px] text-rose-200">
              {t("panels:stackMap.unreadableBytes", { count: model.unreadableCount })}
            </span>
          ) : null}
          {model.unplacedVariables.length > 0 ? (
            <span
              className="rounded-sm border border-amber-500/35 bg-amber-500/[0.06] px-1.5 py-0.5 text-[11.5px] text-amber-200"
              title={model.unplacedVariables.map((node) => node.name).join(", ")}
              data-testid="stack-map-unplaced-variables"
            >
              {t("panels:stackMap.unplacedShort")} · {model.unplacedVariables.length}
            </span>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="stack-map-focus-rsp"
              disabled={!model.rsp}
              onClick={() => focusAddress(model.rsp)}
              className="h-9 rounded-md border border-[#f6ad55]/40 bg-[#f6ad55]/[0.07] px-2.5 text-[12.5px] font-medium text-[#ffd39b] transition-colors hover:border-[#f6ad55]/70 hover:bg-[#f6ad55]/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("panels:stackMap.focusRsp")}
            </button>
            <button
              type="button"
              data-testid="stack-map-focus-rbp"
              disabled={!model.rbp}
              onClick={() => focusAddress(model.rbp)}
              className="h-9 rounded-md border border-[#7db8e8]/40 bg-[#7db8e8]/[0.06] px-2.5 text-[12.5px] font-medium text-[#b9d9f2] transition-colors hover:border-[#7db8e8]/70 hover:bg-[#7db8e8]/[0.11] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("panels:stackMap.focusRbp")}
            </button>
            <button
              type="button"
              data-testid="stack-map-focus-frame"
              disabled={!focusFrame}
              onClick={() => focusFrameTop()}
              className="h-9 rounded-md border border-[#2b3d51] bg-[#0c1520] px-2.5 text-[12.5px] font-medium text-[#b7c7d8] transition-colors hover:border-[#47627e] hover:text-[#e3edf7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("panels:stackMap.focusCurrent")}
            </button>
          </div>
        </div>

        <div
          className="mt-1.5 flex min-w-0 items-center gap-3 overflow-hidden text-[11.5px] text-[#7f93a8]"
          title={t("panels:stackMap.pointerHint")}
        >
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 rounded-sm border border-cyan-400/60 bg-cyan-500/20" />
            {t("panels:stackMap.legendVariable")}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 rounded-sm border border-rose-400/60 bg-rose-500/20" />
            {t("panels:stackMap.legendReturn")}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 rounded-sm border border-sky-400/60 bg-sky-500/20" />
            {t("panels:stackMap.legendSaved")}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 rounded-sm border border-dashed border-[#3a4b5e] bg-[#0d141d]" />
            {t("panels:stackMap.legendUnknown")}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-emerald-400/70" />
            {t("panels:stackMap.legendChanged")}
          </span>
          <span className="shrink-0 text-[#5f7288]">{t("panels:stackMap.growsDown")}</span>

          {model.callChain.length > 0 ? (
            <div
              className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto"
              data-testid="stack-call-chain"
            >
              <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-[#5f7288]">
                {t("panels:stackMap.callStack")}
              </span>
              {model.callChain.slice(0, 8).map((entry) => {
                const frame = model.frames.find((candidate) => candidate.level === entry.level);
                return (
                  <button
                    key={`${entry.level}:${entry.address ?? "?"}`}
                    type="button"
                    data-testid="stack-call-chain-entry"
                    data-level={entry.level}
                    data-visible={entry.memoryVisible ? "true" : "false"}
                    onClick={() => {
                      if (frame) focusFrameByLevel(entry.level);
                    }}
                    disabled={!frame}
                    title={`${entry.function ?? "?"} ${entry.address ?? ""}`}
                    className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
                      frame
                        ? "border-cyan-500/35 bg-cyan-500/[0.06] text-[#b9d9f2] hover:border-cyan-400/60"
                        : "border-[#26384b] bg-[#0b121b] text-[#6e8196]"
                    }`}
                  >
                    #{entry.level} {entry.function ?? t("panels:disassembly.unknownFunction")}
                  </button>
                );
              })}
              {model.callChain.length > 8 ? (
                <span className="shrink-0 font-mono text-[11px] text-[#5f7288]">
                  +{model.callChain.length - 8}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {!snapshot || !model.available ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="rounded-md border border-[#2b3d51] bg-[#0b121b] px-4 py-2 text-[15px] text-[#b7c7d8]">
            {t("panels:stackMap.title")}
          </span>
          <p className="max-w-md text-[14px] leading-6 text-[#7f93a8]">
            {emptyStateReason(model.reason, t)}
          </p>
          {snapshot?.registers.rsp ? (
            <p className="font-mono text-[13px] text-[#9fb2c6]">RSP {snapshot.registers.rsp}</p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between border-b border-[#101b26] px-4 py-1 text-[11.5px] uppercase tracking-[0.12em] text-[#4f6277]">
            <span>{t("panels:stackMap.highAddress")}</span>
            <span>{t("panels:stackMap.scrollHint")}</span>
          </div>

          <div
            className="min-h-0 flex-1 overflow-auto overscroll-contain"
            ref={scrollRef}
            data-testid="stack-map-scroll"
          >
            <div
              className="relative min-w-[720px]"
              ref={contentRef}
              style={{ height: Math.max(1, model.contentHeight) }}
            >
              <AddressRuler ticks={model.rulerTicks} height={model.contentHeight} />

              {model.aboveFrames ? (
                <BandCard
                  block={model.aboveFrames}
                  label={t("panels:stackMap.aboveFrames")}
                  hint={`${model.aboveFrames.start} .. ${model.aboveFrames.end}`}
                  selectedBlockId={selectedBlockId}
                  snapshotId={snapshotId}
                  animationsEnabled={animationsEnabled}
                  reducedMotion={reducedMotion}
                  onSelectBlock={handleSelectBlock}
                  onHoverBlock={handleHoverBlock}
                  rightInset={laneWidth}
                />
              ) : null}

              {model.frames
                .slice()
                .reverse()
                .map((frame) => (
                  <StackFrameCard
                    key={`frame:${frame.level}`}
                    frame={frame}
                    snapshotId={snapshotId}
                    selectedBlockId={selectedBlockId}
                    highlightedBlockIds={highlightedBlockIds}
                    pointerTargetBlockIds={pointerTargetBlockIds}
                    rightInset={laneWidth}
                    animationsEnabled={animationsEnabled}
                    reducedMotion={reducedMotion}
                    pointerLinkFor={(block) => linksByFrom.get(block.id)?.[0] ?? null}
                    targetLabelFor={targetLabelFor}
                    onSelectBlock={handleSelectBlock}
                    onHoverBlock={handleHoverBlock}
                    onExpandTarget={handleExpandTarget}
                  />
                ))}

              {model.belowRsp ? (
                <BandCard
                  block={model.belowRsp}
                  label={t("panels:stackMap.belowRsp")}
                  hint={`${model.belowRsp.start} .. ${model.belowRsp.end}`}
                  selectedBlockId={selectedBlockId}
                  snapshotId={snapshotId}
                  animationsEnabled={animationsEnabled}
                  reducedMotion={reducedMotion}
                  onSelectBlock={handleSelectBlock}
                  onHoverBlock={handleHoverBlock}
                  rightInset={laneWidth}
                />
              ) : null}

              {changedOutsideBlocks.map((mark) => (
                <span
                  key={`change:${mark.address}`}
                  className="pointer-events-none absolute z-20 h-[2px] bg-emerald-400/80"
                  style={{
                    top: mark.top,
                    left: MAP_LEFT,
                    right: laneWidth,
                    boxShadow: "0 0 6px rgba(110,231,183,0.55)",
                  }}
                  title={`${mark.address}: ${mark.before ?? "?"} → ${mark.after ?? "?"}`}
                />
              ))}

              {canDrawPointers ? (
                <svg
                  className="pointer-events-none absolute inset-0 z-20"
                  width={contentWidth}
                  height={model.contentHeight}
                  aria-hidden="true"
                >
                  {renderLinks.map(({ link, fromTop, toTop }, index) => (
                    <PointerArrow
                      key={link.id}
                      link={link}
                      index={index}
                      fromTop={fromTop}
                      toTop={toTop}
                      blockRight={blockRight}
                      laneRight={laneRight}
                      highlighted={hoveredLinkIdSet.has(link.id)}
                      reducedMotion={reducedMotion}
                      onSelect={() => handleExpandTarget(link)}
                      onHover={(id) => setHoveredLinkIds(id ? [id] : [])}
                    />
                  ))}
                </svg>
              ) : null}

              {model.rsp && model.rspTop !== null ? (
                <StackPointerMarker
                  kind="RSP"
                  address={model.rsp}
                  top={model.rspTop}
                  changed={changedRegisters.includes("rsp")}
                  reducedMotion={reducedMotion}
                  onFocus={focusAddress}
                />
              ) : null}
              {model.rbp && model.rbpTop !== null ? (
                <StackPointerMarker
                  kind="RBP"
                  address={model.rbp}
                  top={model.rbpTop}
                  changed={changedRegisters.includes("rbp")}
                  reducedMotion={reducedMotion}
                  onFocus={focusAddress}
                />
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-[#101b26] px-4 py-1 text-[11.5px] uppercase tracking-[0.12em] text-[#4f6277]">
            <span>{t("panels:stackMap.lowAddress")}</span>
            <span>{t("panels:stackMap.clickHint")}</span>
          </div>
        </>
      )}
    </section>
  );
}
