import { useTranslation } from "react-i18next";

import {
  STACK_MAP_FRAME_LABEL_WIDTH,
  STACK_MAP_RULER_WIDTH,
  type PointerLink,
  type StackFrameExtent,
  type StackMapBlock,
} from "../../lib/stackMap";
import { MemoryBlock } from "./MemoryBlock";

interface StackFrameCardProps {
  frame: StackFrameExtent;
  snapshotId: number;
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

/**
 * One verified (or explicitly unverified) stack frame.
 *
 * The frame-name column is outside the byte area, so the header can never hide
 * a saved RBP/return-address block. The byte area itself is a pure function of
 * the real addresses; no header padding is inserted into the address axis.
 */
export function StackFrameCard({
  frame,
  snapshotId,
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
  const accent = current
    ? "border-l-cyan-400/80"
    : frame.verified
      ? "border-l-[#3c6f96]"
      : "border-l-amber-400/70";
  const functionName = frame.function ?? t("panels:disassembly.unknownFunction");
  const fileName = frame.file
    ? frame.file.split(/[\\/]/).filter(Boolean).at(-1) ?? frame.file
    : null;

  return (
    <section
      data-testid="stack-frame-card"
      data-level={frame.level}
      data-function={frame.function ?? ""}
      data-verified={frame.verified ? "true" : "false"}
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
          <div className="sticky top-0 flex min-w-0 flex-col gap-2 overflow-hidden p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] ${
                    current
                      ? "border-cyan-400/40 bg-cyan-500/[0.08] text-cyan-200"
                      : "border-[#33465a] bg-[#0d1722] text-[#9db0c4]"
                  }`}
                >
                  #{frame.level}
                </span>
                <span className="truncate text-[12px] uppercase tracking-[0.08em] text-[#72869c]">
                  {current ? t("panels:stackMap.currentFrame") : t("panels:stackMap.callerFrame")}
                </span>
              </div>
              <h3
                className="mt-1 break-words text-[16px] font-semibold leading-tight text-[#e8f1fa]"
                title={functionName}
              >
                {functionName}
              </h3>
              {frame.file ? (
                <p
                  className="mt-1 truncate font-mono text-[11.5px] leading-4 text-[#7f92a8]"
                  title={frame.file}
                >
                  {fileName}
                  {frame.line !== null ? `:${frame.line}` : ""}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${
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
            <span className="rounded-sm border border-[#2b3d51] bg-[#0c1520] px-1.5 py-0.5 font-mono text-[11px] text-[#8ea3b8]">
              {t("panels:stackMap.frameVariables", { count: frame.variables.length })}
            </span>
          </div>

          <div className="space-y-0.5 font-mono text-[11px] leading-4 text-[#61758b]">
            <div className="truncate" title={frame.start}>
              {frame.start}
            </div>
            <div className="truncate" title={frame.end}>
              {frame.end}
            </div>
          </div>

          {frame.registerVariables.length > 0 ? (
            <div className="text-[11.5px] leading-4 text-[#a9c8e4]">
              <span className="text-[#6d8196]">{t("panels:stackMap.registerVariable")}: </span>
              {frame.registerVariables.map((node) => `${node.name}=${node.value ?? "—"}`).join(", ")}
            </div>
          ) : null}

          {!current && frame.variables.length === 0 ? (
            <p className="border-l border-[#2b3d51] pl-2 text-[11.5px] leading-4 text-[#76899e]">
              {t("panels:stackMap.callerNoDwarf")}
            </p>
          ) : null}
        </div>
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
