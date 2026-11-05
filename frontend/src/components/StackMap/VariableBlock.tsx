import { useTranslation } from "react-i18next";

import type { PointerLink, StackMapBlock } from "../../lib/stackMap";

interface VariableBlockProps {
  block: StackMapBlock;
  link: PointerLink | null;
  targetLabel: string | null;
  selected: boolean;
  highlighted: boolean;
  onExpandTarget: (() => void) | null;
}

/**
 * Localised ownership-evidence message for a variable block. The model never
 * guesses ownership from names, so the UI says exactly what was and was not
 * proven instead of silently attaching the variable to a frame.
 */
function assignmentMessage(block: StackMapBlock, t: (key: string, params?: Record<string, unknown>) => string): string {
  const claimed = block.variable?.frame_level ?? null;
  const geometric = block.frameLevel;
  const geometricLabel = geometric === null ? "—" : `#${geometric}`;
  switch (block.assignmentReason) {
    case "address-in-other-frame":
      return t("panels:stackMap.assignmentConflictFrame", {
        claimed,
        geometric: geometricLabel,
      });
    case "address-outside-claimed-frame":
      return t("panels:stackMap.assignmentConflictOutside", { claimed });
    case "claimed-frame-not-visible":
      return t("panels:stackMap.assignmentUnresolvedClaimed", { claimed });
    case "outside-verified-frames":
      return t("panels:stackMap.assignmentUnresolvedOutside");
    case "frame-level-missing":
      return t("panels:stackMap.assignmentUnresolvedNoLevel");
    default:
      return t("panels:stackMap.assignmentVerified", { claimed });
  }
}

function OwnershipBadge({ block }: { block: StackMapBlock }) {
  const { t } = useTranslation(["panels"]);
  if (!block.assignment || block.assignment === "verified") return null;
  const tone =
    block.assignment === "conflict"
      ? "border-amber-400/60 bg-amber-500/[0.12] text-amber-200"
      : "border-[#5a6d82]/60 bg-[#1a222c] text-[#b9c8d8]";
  return (
    <span
      className={`shrink-0 rounded-sm border px-1 py-0.5 text-[11.5px] font-semibold leading-3 ${tone}`}
      title={assignmentMessage(block, t)}
      data-testid="variable-ownership-badge"
      data-state={block.assignment}
    >
      {block.assignment === "conflict" ? "⚠" : "?"}
    </span>
  );
}

function valueTone(kind: string, isArgument: boolean): string {
  if (isArgument) return "text-amber-100";
  if (kind === "pointer") return "text-sky-100";
  if (kind === "string") return "text-emerald-100";
  if (kind === "array" || kind === "struct" || kind === "union") return "text-violet-100";
  return "text-[#eef5fb]";
}

function pointerBadge(
  link: PointerLink,
  targetLabel: string | null,
  t: (key: string, params?: Record<string, unknown>) => string,
): { text: string; tone: string } {
  switch (link.state) {
    case "resolved":
      return {
        text: targetLabel
          ? t("panels:stackMap.pointerTo", { name: targetLabel })
          : link.targetAddress,
        tone: "border-sky-400/40 bg-sky-500/[0.10] text-sky-200",
      };
    case "null":
      return {
        text: t("panels:stackMap.pointerNull"),
        tone: "border-[#3b4b5e] bg-[#101924] text-[#93a5b8]",
      };
    case "outside-window":
      return {
        text: t("panels:stackMap.pointerOutside"),
        tone: "border-amber-400/40 bg-amber-500/[0.08] text-amber-200",
      };
    case "unreadable":
      return {
        text: t("panels:stackMap.pointerUnreadable"),
        tone: "border-rose-400/40 bg-rose-500/[0.08] text-rose-200",
      };
    default:
      return {
        text: t("panels:stackMap.pointerUnresolved"),
        tone: "border-amber-400/40 bg-amber-500/[0.08] text-amber-200",
      };
  }
}

/**
 * Content for a DWARF-backed variable block. Every string is either the real
 * variable name/type/value/address from the snapshot or a translated label.
 */
export function VariableBlock({
  block,
  link,
  targetLabel,
  selected,
  highlighted,
  onExpandTarget,
}: VariableBlockProps) {
  const { t } = useTranslation(["panels", "common"]);
  const node = block.variable;
  if (!node) return null;
  // MemoryBlock gates micro blocks (< 26 px): VariableBlock only renders when
  // its content provably fits inside the real byte extent. Layout budgets are
  // measured, not guessed:
  //   < 52 px (an int at actual scale)  -> one compact line only;
  //   >= 52 px                          -> name/value + type/address/size line;
  //   >= 64 px                          -> additionally the pointer badge row.
  const compact = block.height < 52;
  const value = node.value;
  const displayedValue =
    node.kind === "string" && node.string_value
      ? `"${node.string_value}"`
      : value ?? t("panels:variables.optimizedOut");
  const badge = link ? pointerBadge(link, targetLabel, t) : null;
  const changed = block.changedBytes.length > 0;
  const sizeText =
    block.sizeBytes === null
      ? t("panels:stackMap.sizeUnknown")
      : t("panels:stackMap.bytes", { count: block.sizeBytes });

  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 truncate text-[13px] font-semibold text-[#e6eef7]">
          {node.name}
        </span>
        <OwnershipBadge block={block} />
        <span className="min-w-0 truncate font-mono text-[13px] text-[#eef5fb]">
          {displayedValue}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[12px] text-[#7f92a8]">
          {block.start}
        </span>
      </span>
    );
  }

  return (
        <span className="flex min-w-0 flex-col justify-center gap-1">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-[16px] font-semibold leading-5 text-[#e9f1f9]">
          {node.name}
        </span>
        <OwnershipBadge block={block} />
        {node.is_argument ? (
          <span className="shrink-0 rounded-sm border border-amber-400/40 bg-amber-500/[0.10] px-1.5 py-0.5 text-[12px] font-medium text-amber-200">
            {t("panels:stackMap.argument")}
          </span>
        ) : null}
        <span
          className={`ml-2 min-w-0 shrink truncate font-mono text-[16px] leading-5 tabular-nums ${valueTone(
            node.kind,
            node.is_argument,
          )}`}
          title={displayedValue}
        >
          {displayedValue}
        </span>
        {changed ? (
          <span
            className="ml-1 shrink-0 rounded-sm border border-emerald-400/50 bg-emerald-500/[0.12] px-1 font-mono text-[11px] font-semibold leading-4 text-emerald-200"
            title={`${t("panels:stackMap.changedCount", { count: block.changedBytes.length })} ${block.changedBytes
              .map((change) => `${change.address}: ${change.before ?? "??"} → ${change.after ?? "??"}`)
              .join(" · ")}`}
            data-testid="variable-changed-count"
          >
            {block.changedBytes.length}
          </span>
        ) : null}
      </span>

      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4">
          <span className="truncate font-mono text-[#8fa2b6]" title={node.type}>
            {node.type}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-[#a7b8c9]">
            {block.start}
          </span>
          <span className="shrink-0 text-[#6f8298]">{sizeText}</span>
          {block.sizeSource === "abi" ? (
            <span
              className="shrink-0 text-[#6f8298]"
              title={t("panels:stackMap.sizeEstimateNote")}
            >
              ≈ ABI
            </span>
          ) : null}
          {node.location_kind === "register" ? (
            <span className="shrink-0 text-sky-300">{t("panels:variables.locationRegister")}</span>
          ) : null}
          {block.clipped ? (
            <span className="shrink-0 text-amber-300">{t("panels:stackMap.clipped")}</span>
          ) : null}
        </span>

      {link && block.height >= 64 ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate rounded-sm border px-1.5 py-0.5 text-[12.5px] ${badge?.tone}`}>
            {badge?.text} · {link.targetAddress}
          </span>
          {onExpandTarget ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onExpandTarget();
              }}
              className="shrink-0 rounded-sm border border-sky-400/30 bg-sky-500/[0.08] px-2 py-1 text-[12.5px] text-sky-200 transition-colors hover:border-sky-300/60 hover:text-sky-100"
            >
              {t("panels:stackMap.expandTarget")}
            </button>
          ) : null}
        </span>
      ) : null}
      {selected ? <span className="sr-only">{t("panels:stackMap.selected")}</span> : null}
      {highlighted ? <span className="sr-only">{t("panels:stackMap.pointerLane")}</span> : null}
    </span>
  );
}
