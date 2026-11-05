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
  const dense = block.height < 38;
  const compact = block.height < 24;
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
        <span className="min-w-0 truncate font-mono text-[13px] text-[#eef5fb]">
          {displayedValue}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-[#7f92a8]">
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
        {node.is_argument ? (
          <span className="shrink-0 rounded-sm border border-amber-400/40 bg-amber-500/[0.10] px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
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
            className="ml-1 shrink-0 rounded-full bg-emerald-400"
            style={{ width: 7, height: 7 }}
            title={t("common:memoryChanged")}
          />
        ) : null}
      </span>

      {dense ? null : (
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
      )}

      {link && block.height >= 48 ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate rounded-sm border px-1.5 py-0.5 text-[11.5px] ${badge?.tone}`}>
            {badge?.text} · {link.targetAddress}
          </span>
          {onExpandTarget ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onExpandTarget();
              }}
              className="shrink-0 rounded-sm border border-sky-400/30 bg-sky-500/[0.08] px-2 py-1 text-[11.5px] text-sky-200 transition-colors hover:border-sky-300/60 hover:text-sky-100"
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
