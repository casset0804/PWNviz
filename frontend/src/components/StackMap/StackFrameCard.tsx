import { useTranslation } from "react-i18next";

import {
  STACK_MAP_MICRO_BLOCK_PX,
  layoutGutterAnnotations,
  type MemoryChangeGroup,
  type PointerLink,
  type StackFrameExtent,
  type StackMapBlock,
} from "../../lib/stackMap";
import { MemoryBlock } from "./MemoryBlock";

interface StackFrameCardProps {
  frame: StackFrameExtent;
  snapshotId: number;
  pxPerByte: number;
  onSelectChangeGroup?: (group: MemoryChangeGroup) => void;
  selectedBlockId: string | null;
  highlightedBlockIds: ReadonlySet<string>;
  pointerTargetBlockIds: ReadonlySet<string>;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  pointerLinkFor: (block: StackMapBlock) => PointerLink | null;
  targetLabelFor: (link: PointerLink) => string | null;
  onSelectBlock: (block: StackMapBlock) => void;
  onHoverBlock: (block: StackMapBlock | null) => void;
  onExpandTarget: (link: PointerLink) => void;
  onFocusFrame: (level: number) => void;
}

/**
 * One real stack frame as a vertical segment of the memory spine (V1.4).
 *
 * The card spans exactly the spine width and the frame's real byte height; no
 * gutter column, no full-width card. The function name is a small chip
 * overlaid at the segment's top edge — it never occupies byte coordinate
 * space. Micro variable blocks get compact name chips stacked along the left
 * edge (anti-overlap layout), with full details one hover/click away.
 */
export function StackFrameCard({
  frame,
  snapshotId,
  pxPerByte,
  onSelectChangeGroup,
  selectedBlockId,
  highlightedBlockIds,
  pointerTargetBlockIds,
  animationsEnabled,
  reducedMotion,
  pointerLinkFor,
  targetLabelFor,
  onSelectBlock,
  onHoverBlock,
  onExpandTarget,
  onFocusFrame,
}: StackFrameCardProps) {
  const { t } = useTranslation(["panels", "common"]);
  const current = frame.level === 0;
  const state = current ? "current" : frame.verified ? "verified" : "warning";
  const functionName = frame.function ?? t("panels:disassembly.unknownFunction");
  const fileName = frame.file
    ? frame.file.split(/[\\/]/).filter(Boolean).at(-1) ?? frame.file
    : null;

  // Micro variable chips stack along the spine's left edge, below the name chip.
  const annotations = layoutGutterAnnotations(frame.blocks, { minTop: 30, chipHeight: 16, gap: 2 });
  const annotationByBlock = new Map(annotations.map((chip) => [chip.blockId, chip]));

  const chipTone =
    state === "current"
      ? "border-cyan-400/70 bg-[#0c2030] text-cyan-100"
      : state === "verified"
        ? "border-[#3c6f96]/60 bg-[#0b1420] text-[#c3d3e4]"
        : "border-amber-400/60 bg-[#221a10] text-amber-100";

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
      className={`absolute left-0 right-0 ${current ? "bg-cyan-500/[0.045]" : "bg-transparent"}`}
      style={{
        top: frame.top,
        height: Math.max(1, frame.height),
      }}
    >
      {/* Frame boundary: one hairline at the segment's top edge only. */}
      <div
        className={`absolute left-0 right-0 top-0 h-px ${
          current ? "bg-cyan-400/50" : frame.verified ? "bg-[#3c6f96]/45" : "bg-amber-400/40"
        }`}
        aria-hidden="true"
      />

      {/* Function name chip: independent tag, overlays the top edge without
          occupying byte coordinate space. */}
      <button
        type="button"
        data-testid="stack-frame-chip"
        data-level={frame.level}
        data-state={state}
        title={`${functionName}${frame.line !== null ? `:${frame.line}` : ""} · ${frame.start} – ${frame.end} · ${t(
          "panels:stackMap.frameVariables",
          { count: frame.variables.length },
        )}`}
        onClick={() => onFocusFrame(frame.level)}
        className={`absolute left-1 top-1 z-20 flex max-w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-sm border px-1.5 py-1 text-left shadow-[0_1px_6px_rgba(0,0,0,0.45)] ${chipTone}`}
      >
        <span className="shrink-0 rounded-[2px] bg-white/[0.08] px-1 font-mono text-[11px] leading-4 text-white/70">
          #{frame.level}
        </span>
        <span className="min-w-0 truncate text-[16px] font-semibold leading-5" title={functionName}>
          {functionName}
        </span>
        {fileName ? (
          <span className="hidden shrink-0 font-mono text-[11px] leading-4 text-white/45 2xl:inline">
            {fileName}
            {frame.line !== null ? `:${frame.line}` : ""}
          </span>
        ) : null}
        {!frame.verified ? (
          <span
            className="shrink-0 rounded-[2px] border border-amber-400/40 px-1 text-[11px] leading-4 text-amber-200"
            title={
              frame.returnAddress
                ? t("panels:stackMap.frameEntry")
                : t("panels:stackMap.frameUnverified")
            }
          >
            {frame.returnAddress
              ? t("panels:stackMap.frameEntryShort")
              : t("panels:stackMap.frameUnverifiedShort")}
          </span>
        ) : null}
      </button>

      {/* Micro variable name chips along the left edge (details on hover/click). */}
      {frame.blocks
        .filter(
          (block) =>
            block.kind === "variable" &&
            block.height < STACK_MAP_MICRO_BLOCK_PX &&
            annotationByBlock.has(block.id),
        )
        .map((block) => {
          const chip = annotationByBlock.get(block.id)!;
          return (
            <button
              key={`chip:${block.id}`}
              type="button"
              data-testid="stack-frame-var-chip"
              data-block={block.id}
              className="absolute left-1 z-10 flex h-4 max-w-[110px] items-center gap-1 rounded-[2px] border border-[#2b3d51] bg-[#0d1622]/95 px-1 text-[11px] leading-none text-[#9fc3e8] shadow-[0_1px_4px_rgba(0,0,0,0.5)] transition-colors hover:border-[#47627e] hover:text-[#e3edf7]"
              style={{ top: chip.chipTop }}
              title={`${block.label} · ${block.type ?? "?"} · ${block.start} · ${block.frameOffset ?? ""}`}
              onClick={() => onSelectBlock(block)}
              onMouseEnter={() => onHoverBlock(block)}
              onMouseLeave={() => onHoverBlock(null)}
            >
              <span className="truncate font-mono">{block.label}</span>
            </button>
          );
        })}

      {frame.registerVariables.length > 0 ? (
        <div
          className="pointer-events-none absolute bottom-0.5 left-1 right-1 truncate text-[11px] leading-4 text-[#6d8196]"
          title={frame.registerVariables.map((node) => `${node.name}=${node.value ?? "—"}`).join(", ")}
        >
          {frame.registerVariables.map((node) => `${node.name}=${node.value ?? "—"}`).join("  ")}
        </div>
      ) : null}

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
            pxPerByte={pxPerByte}
            snapshotId={snapshotId}
            animationsEnabled={animationsEnabled}
            reducedMotion={reducedMotion}
            onSelectChangeGroup={onSelectChangeGroup}
            onSelect={onSelectBlock}
            onHover={onHoverBlock}
            onExpandTarget={link ? () => onExpandTarget(link) : null}
          />
        );
      })}
    </section>
  );
}
