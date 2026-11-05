import { useTranslation } from "react-i18next";

import {
  STACK_MAP_FRAME_LABEL_WIDTH,
  STACK_MAP_MICRO_BLOCK_PX,
  STACK_MAP_RULER_WIDTH,
  layoutGutterAnnotations,
  type PointerLink,
  type StackFrameExtent,
  type StackMapBlock,
} from "../../lib/stackMap";
import { MemoryBlock } from "./MemoryBlock";

interface StackFrameCardProps {
  frame: StackFrameExtent;
  snapshotId: number;
  pxPerByte: number;
  selectedBlockId: string | null;
  highlightedBlockIds: ReadonlySet<string>;
  pointerTargetBlockIds: ReadonlySet<string>;
  rightInset: number;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  pointerLinkFor: (block: StackMapBlock) => PointerLink | null;
  targetLabelFor: (link: PointerLink) => string | null;
  onSelectBlock: (block: StackMapBlock) => void;
  onHoverBlock: (block: StackMapBlock | null) => void;
  onExpandTarget: (link: PointerLink) => void;
}

/** Fixed title-plate height (pixels). Lives in the label gutter only. */
const FRAME_PLATE_HEIGHT = 88;

/**
 * One verified (or explicitly unverified) stack frame.
 *
 * Layout contract:
 *  - the title plate is a fixed-height tag inside the frame-label gutter; it
 *    never occupies the real memory/address axis, and small frames still get
 *    the full plate (it may extend past a shorter frame's bottom edge);
 *  - micro variable blocks get their names as chips in the same gutter, with
 *    a leader pointing at the block's real centre — never inside the bytes;
 *  - the byte area itself is a pure function of the real addresses; no plate
 *    or chip padding is inserted into the address axis and no frame boundary
 *    is ever invented.
 */
export function StackFrameCard({
  frame,
  snapshotId,
  pxPerByte,
  selectedBlockId,
  highlightedBlockIds,
  pointerTargetBlockIds,
  rightInset,
  animationsEnabled,
  reducedMotion,
  pointerLinkFor,
  targetLabelFor,
  onSelectBlock,
  onHoverBlock,
  onExpandTarget,
}: StackFrameCardProps) {
  const { t } = useTranslation(["panels", "common"]);
  const current = frame.level === 0;
  // Visual state: current frame = highlight, verified caller = secondary,
  // unverifiable frame = warning. Boundaries are never faked either way.
  const state = current ? "current" : frame.verified ? "verified" : "warning";
  const accent =
    state === "current"
      ? "border-l-cyan-400/80"
      : state === "verified"
        ? "border-l-[#3c6f96]"
        : "border-l-amber-400/70";
  const functionName = frame.function ?? t("panels:disassembly.unknownFunction");
  const fileName = frame.file
    ? frame.file.split(/[\\/]/).filter(Boolean).at(-1) ?? frame.file
    : null;

  const annotations = layoutGutterAnnotations(frame.blocks, {
    minTop: FRAME_PLATE_HEIGHT + 6,
  });
  const annotationByBlock = new Map(annotations.map((chip) => [chip.blockId, chip]));

  const plateTone =
    state === "current"
      ? "border-cyan-400/50 bg-[#0d1c2c]/95 text-[#e8f1fa]"
      : state === "verified"
        ? "border-[#3c6f96]/60 bg-[#0b1420]/95 text-[#c3d3e4]"
        : "border-amber-400/50 bg-[#1d1710]/95 text-[#f2e3c8]";

  return (
    <section
      data-testid="stack-frame-card"
      data-level={frame.level}
      data-function={frame.function ?? ""}
      data-verified={frame.verified ? "true" : "false"}
      data-state={state}
      data-start={frame.start}
      data-end={frame.end}
      aria-label={`${t("common:stackFrame")} ${frame.level}: ${functionName}`}
      className={`absolute right-0 z-10 border-l-2 ${accent} ${
        current ? "bg-[#0a1420]/80" : "bg-[#090f17]/60"
      } border-y border-y-[#1a2939]/70`}
      style={{
        left: STACK_MAP_RULER_WIDTH,
        top: frame.top,
        height: Math.max(1, frame.height),
      }}
    >
      <div
        className="grid h-full"
        style={{ gridTemplateColumns: `${STACK_MAP_FRAME_LABEL_WIDTH}px minmax(0,1fr)` }}
      >
        <div className="relative h-full min-w-0 border-r border-[#1b2a3a] bg-[#0a1119]/85">
          {/* Fixed-height title plate: independent of frame height, outside the
              address axis. Overlaps only the gutter, never the byte area. */}
          <div
            className={`sticky top-0 z-20 flex flex-col gap-1.5 overflow-hidden rounded-sm border border-l-0 p-2 shadow-[0_2px_10px_rgba(0,0,0,0.4)] ${plateTone}`}
            style={{ height: FRAME_PLATE_HEIGHT }}
            data-testid="stack-frame-plate"
          >
            <div className="relative flex min-w-0 items-center gap-2">
              <span
                className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[12px] ${
                  current
                    ? "border-cyan-400/40 bg-cyan-500/[0.08] text-cyan-200"
                    : "border-[#33465a] bg-[#0d1722] text-[#9db0c4]"
                }`}
              >
                #{frame.level}
              </span>
              <span className="truncate text-[12.5px] uppercase tracking-[0.08em] text-[#72869c]">
                {current ? t("panels:stackMap.currentFrame") : t("panels:stackMap.callerFrame")}
              </span>
              <span
                className={`ml-auto shrink-0 rounded-sm border px-1.5 py-0.5 text-[11.5px] font-medium ${
                  frame.verified
                    ? "border-emerald-500/35 bg-emerald-500/[0.07] text-emerald-200"
                    : "border-amber-500/40 bg-amber-500/[0.07] text-amber-200"
                }`}
                title={
                  frame.verified
                    ? t("panels:stackMap.frameVerified")
                    : frame.returnAddress
                      ? t("panels:stackMap.frameEntry")
                      : t("panels:stackMap.frameUnverified")
                }
              >
                {frame.verified
                  ? t("panels:stackMap.frameVerifiedShort")
                  : frame.returnAddress
                    ? t("panels:stackMap.frameEntryShort")
                    : t("panels:stackMap.frameUnverifiedShort")}
              </span>
            </div>
            <h3
              className="relative line-clamp-2 break-all text-[15px] font-semibold leading-[19px] text-[#e8f1fa]"
              title={functionName}
            >
              {functionName}
            </h3>
            <div className="relative flex min-w-0 items-center gap-2 font-mono text-[12px] leading-4 text-[#7f92a8]">
              <span className="min-w-0 truncate" title={frame.file ?? undefined}>
                {fileName ?? t("panels:stackMap.noDwarfShort")}
                {frame.line !== null ? `:${frame.line}` : ""}
              </span>
              <span className="ml-auto shrink-0" title={`${frame.start} .. ${frame.end}`}>
                {t("panels:stackMap.frameVariables", { count: frame.variables.length })}
              </span>
            </div>
          </div>

          {/* External names for micro variable blocks (char/short and anything
              smaller at fit zoom). Chips live in the gutter with a leader to
              the block's real centre. */}
          {frame.blocks
            .filter(
              (block) =>
                block.kind === "variable" &&
                block.height < STACK_MAP_MICRO_BLOCK_PX &&
                annotationByBlock.has(block.id),
            )
            .map((block) => {
              const chip = annotationByBlock.get(block.id)!;
              const chipCenter = chip.chipTop + 9;
              const leaderTop = Math.min(chipCenter, chip.anchorTop);
              const leaderHeight = Math.max(1, Math.abs(chip.anchorTop - chipCenter));
              return (
                <div key={`chip:${block.id}`} aria-hidden="true">
                  {/* Leader: vertical line from the chip to the block's real
                      centre, then a dot on the block edge. */}
                  <span
                    className="absolute right-1 z-10 w-px bg-[#5f7c96]/70"
                    style={{ top: leaderTop, height: leaderHeight }}
                  />
                  <span
                    className="absolute right-[3px] z-10 h-1.5 w-1.5 rounded-full border border-[#7db8e8]/70 bg-[#0d1722]"
                    style={{ top: chip.anchorTop - 3 }}
                  />
                  <button
                    type="button"
                    data-testid="stack-frame-gutter-chip"
                    data-block={block.id}
                    className="absolute left-1.5 z-10 flex h-[18px] max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-sm border border-[#2b3d51] bg-[#0d1622] px-1.5 text-[12.5px] leading-none text-[#b9c8d8] shadow-[0_1px_6px_rgba(0,0,0,0.5)] transition-colors hover:border-[#47627e] hover:text-[#e3edf7]"
                    style={{ top: chip.chipTop }}
                    title={`${block.label} · ${block.start} · ${t("panels:stackMap.clickToInspect")}`}
                    onClick={() => onSelectBlock(block)}
                    onMouseEnter={() => onHoverBlock(block)}
                    onMouseLeave={() => onHoverBlock(null)}
                  >
                    <span className="shrink-0 font-mono text-[#9fc3e8]">{block.label}</span>
                    <span className="min-w-0 truncate font-mono text-[11.5px] text-[#7f92a8]">
                      {block.sizeBytes ?? "?"}B
                    </span>
                  </button>
                </div>
              );
            })}

          {frame.registerVariables.length > 0 ? (
            <div
              className="absolute bottom-1 left-1.5 right-1.5 truncate text-[12px] leading-4 text-[#a9c8e4]"
              title={frame.registerVariables.map((node) => `${node.name}=${node.value ?? "—"}`).join(", ")}
            >
              <span className="text-[#6d8196]">{t("panels:stackMap.registerVariable")}: </span>
              {frame.registerVariables.map((node) => `${node.name}=${node.value ?? "—"}`).join(", ")}
            </div>
          ) : null}
        </div>

        <div className="relative min-w-0">
          {frame.blocks.map((block) => {
            const link = pointerLinkFor(block);
            return (
              <MemoryBlock
                key={block.id}
                block={block}
                pointerLink={link}
                targetLabel={link ? targetLabelFor(link) : null}
                selected={selectedBlockId === block.id}
                highlighted={highlightedBlockIds.has(block.id)}
                pointerTarget={pointerTargetBlockIds.has(block.id)}
                rightInset={rightInset}
                snapshotId={snapshotId}
                animationsEnabled={animationsEnabled}
                reducedMotion={reducedMotion}
                pxPerByte={pxPerByte}
                onSelect={onSelectBlock}
                onHover={onHoverBlock}
                onExpandTarget={link ? () => onExpandTarget(link) : null}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
