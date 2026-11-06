import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { explainStep, type Translate } from "../../lib/explain";
import { useDebugStore } from "../../stores/debugStore";

/**
 * The large "current instruction" band.
 *
 * The big line is the instruction at RIP, which has *not* executed yet. The
 * explanation on the right is always about the instruction that just executed:
 * `explainStep` only emits a rule when the measured before/after evidence
 * supports it. Nothing here predicts what the current instruction will do.
 */
export function CurrentInstruction() {
  const { t } = useTranslation(["panels", "explanation", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const lastAction = useDebugStore((state) => state.lastAction);

  const translate = useCallback<Translate>(
    (key, params) => String(t(`explanation:${key}`, (params ?? {}) as never)),
    [t],
  );

  const explanation = useMemo(
    () => explainStep(previousSnapshot, snapshot, lastAction, translate),
    [previousSnapshot, snapshot, lastAction, translate],
  );

  if (!snapshot) {
    return (
      <section
        className="flex min-h-[82px] shrink-0 items-center gap-4 border-b border-[#182636] bg-[#081019] px-4 py-2.5"
        data-testid="current-instruction"
        data-state="empty"
      >
        <div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-[#5f7388]">
            {t("panels:instruction.title")}
          </div>
          <p className="mt-1 text-[15px] text-[#8fa3b8]">{t("panels:instruction.stepHint")}</p>
        </div>
      </section>
    );
  }

  const instruction = snapshot.instruction;
  const frame = snapshot.frames[0] ?? null;
  const executed = previousSnapshot?.instruction ?? null;
  const matched = explanation.matched && Boolean(previousSnapshot);

  return (
    <section
      className="flex min-h-[82px] shrink-0 flex-wrap items-stretch gap-x-6 gap-y-2 border-b border-[#182636] bg-[#081019] px-4 py-2"
      data-testid="current-instruction"
      data-state={instruction ? "ready" : "empty"}
      data-matched={matched ? "true" : "false"}
    >
      <div className="flex min-w-0 flex-[1.4] items-center gap-4">
        <span className="shrink-0 rounded-sm border border-cyan-400/40 bg-cyan-500/[0.08] px-2 py-1 font-mono text-[11.5px] uppercase tracking-[0.10em] text-cyan-200">
          {t("panels:instruction.rip")}
        </span>
        <div className="min-w-0">
          <div className="text-[12px] uppercase tracking-[0.14em] text-[#5f7388]">
            {t("panels:instruction.title")}
          </div>
          {instruction ? (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="min-w-0 break-all font-mono text-[21px] font-semibold leading-tight text-[#e8f4fd]">
                {instruction.text ?? instruction.mnemonic ?? "—"}
              </span>
              <span className="shrink-0 font-mono text-[13px] tabular-nums text-cyan-300/90">
                {instruction.address}
              </span>
              {instruction.bytes ? (
                <span className="shrink-0 font-mono text-[12px] text-[#5f7388]">
                  {instruction.bytes}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-[15px] text-[#8fa3b8]">{t("panels:instruction.pending")}</p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 border-l border-[#1b2a3a] pl-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-medium text-[#c8d8e8]">
            {frame?.function ?? t("panels:disassembly.unknownFunction")}
          </span>
          <span className="text-[12px] uppercase tracking-[0.10em] text-[#5f7388]">
            {t("panels:instruction.notExecuted")}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[12px] text-[#70849a]">
          {frame?.file ? (
            <span className="break-all">
              {frame.file}
              {frame.line !== null ? `:${frame.line}` : ""}
            </span>
          ) : null}
          <span>{snapshot.stop_reason ?? t("panels:disassembly.stopped")}</span>
          {executed ? (
            <span className="text-[#5f7388]">
              {t("panels:instruction.previous")}: {executed.text}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-[1.2] flex-col justify-center gap-1 border-l border-[#1b2a3a] pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] uppercase tracking-[0.12em] text-[#5f7388]">
            {t("panels:instruction.verifiedExplanation")}
          </span>
          <span
            className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${
              matched
                ? "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-200"
                : "border-amber-500/35 bg-amber-500/[0.06] text-amber-200"
            }`}
          >
            {matched ? t("panels:instruction.verified") : t("panels:instruction.unverified")}
          </span>
        </div>
        {/* V1.4: exactly ONE concise verified line here — the Inspector Drawer
            (on selection) and DeveloperWorkbench's BottomDock carry details. */}
        <div className="truncate text-[15px] font-medium text-[#dbeaf7]" title={explanation.headline}>
          {previousSnapshot ? explanation.headline : t("panels:instruction.noPrevious")}
        </div>
      </div>
    </section>
  );
}
