import { useTranslation } from "react-i18next";

import type { PointerLink, StackMapBlock } from "../../lib/stackMap";
import { MemoryChangeOverlay } from "./MemoryChangeOverlay";
import { VariableBlock } from "./VariableBlock";

interface MemoryBlockProps {
  block: StackMapBlock;
  pointerLink: PointerLink | null;
  targetLabel: string | null;
  selected: boolean;
  highlighted: boolean;
  pointerTarget?: boolean;
  rightInset?: number;
  snapshotId: number;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  onSelect: (block: StackMapBlock) => void;
  onHover: (block: StackMapBlock | null) => void;
  onExpandTarget: (() => void) | null;
  /** The band containers already render the title in their own gutter. */
  showLabel?: boolean;
}

function variableTone(block: StackMapBlock): string {
  const node = block.variable;
  if (node?.is_argument) {
    return "border-l-amber-400/80 bg-[#1b1710]/95";
  }
  if (node?.kind === "pointer") {
    return "border-l-sky-400/80 bg-[#0b1823]/95";
  }
  if (node?.kind === "string") {
    return "border-l-emerald-400/80 bg-[#0a1a17]/95";
  }
  if (node?.kind === "array" || node?.kind === "struct" || node?.kind === "union") {
    return "border-l-violet-400/80 bg-[#13121f]/95";
  }
  return "border-l-cyan-400/70 bg-[#0d1722]/95";
}

function blockClasses(block: StackMapBlock): string {
  if (block.kind === "variable") {
    return `${variableTone(block)} ${block.pin ? "border border-dashed border-[#3a4b5e]" : ""}`;
  }
  if (block.kind === "saved-rbp") {
    return "border-l-sky-400 bg-[#0c1c2c]/95";
  }
  if (block.kind === "return-address") {
    return "border-l-rose-400 bg-[#1c1119]/95";
  }
  if (block.kind === "unreadable") {
    return "border border-dashed border-rose-400/40 stack-map-unreadable";
  }
  if (block.kind === "unknown") {
    return "border border-dashed border-[#2c3d51] stack-map-unknown";
  }
  if (block.kind === "below-rsp") {
    return "border border-dotted border-[#2a3a4c] stack-map-quiet";
  }
  return "border border-dotted border-[#2a3a4c] stack-map-quiet";
}

export function MemoryBlock({
  block,
  pointerLink,
  targetLabel,
  selected,
  highlighted,
  pointerTarget = false,
  rightInset = 76,
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
  const veryCompact = height < 12;
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
      className={`group absolute left-2 overflow-hidden rounded-sm border-l-[3px] px-2.5 outline-none transition-[box-shadow,background-color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${blockClasses(
        block,
      )} ${
        selected
          ? "z-20 ring-2 ring-amber-300/90"
          : highlighted
            ? "z-20 ring-2 ring-sky-300/80"
            : pointerTarget
              ? "z-10 ring-1 ring-inset ring-sky-400/45"
              : block.overlaps
                ? "z-10 outline outline-1 -outline-offset-1 outline-amber-400/45"
                : "z-10"
      }`}
      style={{ top: block.top, height, right: rightInset }}
    >
      {changed ? (
        <MemoryChangeOverlay
          key={`${snapshotId}:${block.id}`}
          changedCount={block.changedBytes.length}
          animationsEnabled={animationsEnabled}
          reducedMotion={reducedMotion}
        />
      ) : null}

      {block.kind === "variable" ? (
        <VariableBlock
          block={block}
          link={pointerLink}
          targetLabel={targetLabel}
          selected={selected}
          highlighted={highlighted}
          onExpandTarget={onExpandTarget}
        />
      ) : null}

      {block.kind === "saved-rbp" || block.kind === "return-address" ? (
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
              <span className="shrink-0 text-[11.5px] text-rose-300">
                {t("panels:stackMap.unreadable")}
              </span>
            ) : null}
          </span>
          {!compact ? (
            <span className="flex items-center gap-3 font-mono text-[11.5px] text-[#8fa2b6]">
              <span>{block.start}</span>
              <span>{sizeText}</span>
            </span>
          ) : null}
        </span>
      ) : null}

      {block.kind !== "variable" &&
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
            {!veryCompact && height >= 28 ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-[#5f7288]">
                <span>{block.start}</span>
                <span>{sizeText}</span>
                {block.kind === "unknown" ? (
                  <span>{t("panels:stackMap.unknownBlockNote")}</span>
                ) : null}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 rounded-sm border border-[#2b3c50] bg-[#0a1119]/70 px-1.5 py-0.5 font-mono text-[11px] text-[#6f8298]">
            {block.sizeBytes === null ? "?" : `${block.sizeBytes} B`}
          </span>
        </span>
      ) : null}
    </div>
  );
}
