import { useTranslation } from "react-i18next";

import {
  STACK_MAP_MICRO_BLOCK_PX,
  type MemoryChangeGroup,
  type PointerLink,
  type StackMapBlock,
} from "../../lib/stackMap";
import { MemoryChangeOverlay } from "./MemoryChangeOverlay";
import { VariableBlock } from "./VariableBlock";

interface MemoryBlockProps {
  block: StackMapBlock;
  pointerLink: PointerLink | null;
  targetLabel: string | null;
  selected: boolean;
  highlighted: boolean;
  pointerTarget?: boolean;
  /** Current map scale; change marks are positioned at exact byte rows. */
  pxPerByte: number;
  /** Open the Inspector on a clicked change run. */
  onSelectChangeGroup?: (group: MemoryChangeGroup) => void;
  snapshotId: number;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  onSelect: (block: StackMapBlock) => void;
  onHover: (block: StackMapBlock | null) => void;
  onExpandTarget: (() => void) | null;
  /** The band containers already render the title in their own gutter. */
  showLabel?: boolean;
}

function variableTone(): string {
  // V1.4 palette: one green family for all variables; kind/argument
  // differences are carried by small chips inside the block, not extra hues.
  return "border-l-emerald-400/90 bg-[#0b1810]";
}

function blockClasses(block: StackMapBlock): string {
  if (block.kind === "variable") {
    // One left accent = the single main separator. Ownership state is carried
    // by the badge/tooltip, not by extra outlines around the block.
    return `${variableTone()} ${block.pin ? "border-b border-dashed border-b-[#3a4b5e]" : ""}`;
  }
  if (block.kind === "saved-rbp") {
    return "border-l-sky-400 bg-[#0c1626]";
  }
  if (block.kind === "return-address") {
    return "border-l-rose-400/90 bg-[#1c1016]";
  }
  // Flat band fills (no dashed/dotted boxes, no repeating textures).
  if (block.kind === "unreadable") {
    return "border-l-0 stack-map-unreadable";
  }
  if (block.kind === "unknown") {
    return "border-l-0 stack-map-unknown";
  }
  if (block.kind === "below-rsp") {
    return "border-l-0 stack-map-quiet";
  }
  return "border-l-0 stack-map-above";
}

export function MemoryBlock({
  block,
  pointerLink,
  targetLabel,
  selected,
  highlighted,
  pointerTarget = false,
  pxPerByte,
  onSelectChangeGroup,
  snapshotId,
  animationsEnabled,
  reducedMotion,
  onSelect,
  onHover,
  onExpandTarget,
  showLabel = true,
}: MemoryBlockProps) {
  const { t } = useTranslation(["panels", "common"]);
  const height = Math.max(1, block.height);
  /**
   * Micro blocks (1–2 real bytes at actual scale; anything smaller at fit
   * zoom) carry no internal text at all — text can never fit without lying
   * about the byte extent. Names live in the frame gutter, details on hover.
   */
  const micro = height < STACK_MAP_MICRO_BLOCK_PX;
  const compact = height < 44;
  const changed = block.changedBytes.length > 0;

  const labelForUnknown = (): string => {
    if (block.kind === "unreadable") return t("panels:stackMap.unreadable");
    if (block.kind === "below-rsp") return t("panels:stackMap.belowRsp");
    if (block.kind === "above-frames") return t("panels:stackMap.aboveFrames");
    return t("panels:stackMap.unknownMemory");
  };

  const sizeText =
    block.sizeBytes === null
      ? t("panels:stackMap.sizeUnknown")
      : t("panels:stackMap.bytes", { count: block.sizeBytes });

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="stack-map-block"
      data-kind={block.kind}
      data-address={block.start}
      data-end={block.end}
      data-size={block.sizeBytes ?? ""}
      data-changed={changed ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-unreadable={block.readable ? "false" : "true"}
      data-overlap={block.overlaps ? "true" : "false"}
      data-micro={micro ? "true" : "false"}
      data-assignment={block.assignment ?? ""}
      aria-label={`${block.label || labelForUnknown()} ${block.start} ${sizeText}`}
      title={`${block.label || labelForUnknown()} · ${block.start} · ${sizeText}`}
      onClick={() => onSelect(block)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(block);
        }
      }}
      onMouseEnter={() => onHover(block)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(block)}
      onBlur={() => onHover(null)}
      className={`group pointer-events-auto absolute inset-x-0 overflow-hidden rounded-sm border-l-[3px] px-2.5 outline-none transition-[box-shadow,background-color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${blockClasses(
        block,
      )} ${
        selected
          ? "z-20 ring-2 ring-amber-300/90"
          : highlighted
            ? "z-20 ring-2 ring-sky-300/80"
            : pointerTarget
              ? "z-10 ring-1 ring-inset ring-sky-400/45"
              : "z-10"
      }`}
      style={{ top: block.top, height }}
    >
      {changed ? (
        <MemoryChangeOverlay
          key={`${snapshotId}:${block.id}`}
          changes={block.changedBytes}
          blockEnd={block.end}
          pxPerByte={pxPerByte}
          animationsEnabled={animationsEnabled}
          reducedMotion={reducedMotion}
          onSelectChangeGroup={onSelectChangeGroup}
        />
      ) : null}

      {micro ? (
        // Micro block: a compact marker keeps the block identifiable without
        // ever letting text overflow the real byte extent.
        <span
          aria-hidden="true"
          className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-[1px] bg-[#9fc3e8]/70"
        />
      ) : null}

      {!micro && block.kind === "variable" ? (
        <VariableBlock
          block={block}
          link={pointerLink}
          targetLabel={targetLabel}
          selected={selected}
          highlighted={highlighted}
          onExpandTarget={onExpandTarget}
        />
      ) : null}

      {!micro && (block.kind === "saved-rbp" || block.kind === "return-address") ? (
        <span className={`flex min-w-0 flex-col justify-center ${compact ? "gap-0" : "gap-1"}`}>
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={`shrink-0 text-[12.5px] font-semibold uppercase tracking-[0.06em] ${
                block.kind === "saved-rbp" ? "text-sky-300" : "text-rose-300"
              }`}
            >
              {block.kind === "saved-rbp"
                ? t("panels:stackMap.savedRbp")
                : t("panels:stackMap.returnAddress")}
            </span>
            <span className="min-w-0 truncate font-mono text-[15px] tabular-nums text-[#e9f1f9]">
              {block.value ?? t("common:unreadable")}
            </span>
            {!block.readable ? (
              <span className="shrink-0 text-[12.5px] text-rose-300">
                {t("panels:stackMap.unreadable")}
              </span>
            ) : null}
          </span>
          {!compact ? (
            <span className="flex items-center gap-3 font-mono text-[12.5px] text-[#8fa2b6]">
              <span>{block.start}</span>
              <span>{sizeText}</span>
            </span>
          ) : null}
        </span>
      ) : null}

      {!micro &&
      block.kind !== "variable" &&
      block.kind !== "saved-rbp" &&
      block.kind !== "return-address" ? (
        <span className="flex h-full min-w-0 items-start justify-between gap-3 py-2">
          <span className="flex min-w-0 flex-col gap-1">
            {showLabel ? (
              <span
                className={`truncate text-[13px] font-medium ${
                  block.kind === "unreadable" ? "text-rose-200/90" : "text-[#8194a8]"
                }`}
              >
                {labelForUnknown()}
              </span>
            ) : null}
            {!compact && height >= 28 ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[12.5px] text-[#5f7288]">
                <span>{block.start}</span>
                <span>{sizeText}</span>
                {block.kind === "unknown" ? (
                  <span>{t("panels:stackMap.unknownBlockNote")}</span>
                ) : null}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 rounded-sm border border-[#2b3c50] bg-[#0a1119]/70 px-1.5 py-0.5 font-mono text-[12px] text-[#6f8298]">
            {block.sizeBytes === null ? "?" : `${block.sizeBytes} B`}
          </span>
        </span>
      ) : null}
    </div>
  );
}
