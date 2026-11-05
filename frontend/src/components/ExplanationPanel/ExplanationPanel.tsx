import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { explainStep, type Translate } from "../../lib/explain";
import { useDebugStore } from "../../stores/debugStore";
import { StatusBadge } from "../common/StatusBadge";

export function ExplanationPanel() {
  const { t } = useTranslation(["panels", "explanation", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const selectedInstructionAddress = useDebugStore(
    (state) => state.selectedInstructionAddress,
  );
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
      <div className="flex h-full flex-col gap-2 p-4">
        <StatusBadge tone="idle">{t("panels:explanation.noSnapshot")}</StatusBadge>
        <p className="max-w-2xl text-[11px] leading-5 text-slate-500">
          {t("panels:explanation.emptyHint")}
        </p>
      </div>
    );
  }

  const executedInstruction = previousSnapshot?.instruction ?? null;
  const selected =
    snapshot.disassembly.find((line) => line.address === selectedInstructionAddress) ?? null;

  return (
    <div className="space-y-3 p-4" data-testid="explanation-panel" data-matched={explanation.matched ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={explanation.matched ? "ok" : "info"}>
          {explanation.matched
            ? t("panels:explanation.rule", { rule: explanation.rule })
            : t("panels:explanation.measuredOnly")}
        </StatusBadge>
        <span className="font-mono text-[10px] text-slate-600">
          {t("panels:explanation.executedFrom", {
            from: previousSnapshot?.snapshot_id ?? "?",
            to: snapshot.snapshot_id,
          })}
        </span>
        <span className="font-mono text-[10px] text-slate-600">
          {t("panels:explanation.action", {
            action: lastAction ?? t("panels:explanation.attached"),
          })}
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.15fr_1fr]">
        <section className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {t("panels:explanation.lastInstruction")}
          </h3>
          {executedInstruction ? (
            <>
              <div className="mt-1 font-mono text-[12px] text-cyan-200">
                {executedInstruction.address} · {executedInstruction.text}
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-600">
                {t("panels:explanation.bytes")}{" "}
                {executedInstruction.bytes ?? t("panels:explanation.unavailable")} ·{" "}
                {t("panels:explanation.mnemonic")}{" "}
                {executedInstruction.mnemonic ?? t("panels:explanation.unknownMnemonic")}
              </div>
            </>
          ) : (
            <p className="mt-1 font-mono text-[10px] text-slate-600">
              {t("panels:explanation.noPrevious")}
            </p>
          )}

          <div className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-2">
            <div className="text-[11px] font-medium text-cyan-100">{explanation.headline}</div>
            {explanation.lines.map((line) => (
              <p key={line} className="mt-1 text-[10px] leading-5 text-slate-300">
                {line}
              </p>
            ))}
          </div>

          {snapshot.instruction ? (
            <div className="mt-3 border-t border-[#1e2635] pt-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                {t("panels:explanation.nextInstruction")}
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-300">
                {snapshot.instruction.address} · {snapshot.instruction.text}
              </div>
            </div>
          ) : null}

          {selected ? (
            <div className="mt-3 border-t border-[#1e2635] pt-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                {t("panels:explanation.selectedLine")}
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-300">
                {selected.address} · {selected.text}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {t("panels:explanation.verifiedFacts")}
          </h3>
          <ul className="mt-2 space-y-1 font-mono text-[10px] leading-5 text-slate-400">
            {explanation.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] leading-5 text-slate-500">
            {t("panels:explanation.rbpNote")}
          </p>
          {snapshot.stack.unreadable_ranges.length > 0 ? (
            <p className="mt-2 font-mono text-[10px] text-rose-300/80">
              {t("panels:explanation.unreadableNote", {
                count: snapshot.stack.unreadable_ranges.length,
              })}
            </p>
          ) : null}
          {snapshot.warnings.length > 0 ? (
            <div className="mt-3 border-t border-[#1e2635] pt-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-amber-300/80">
                {t("panels:explanation.warnings")}
              </div>
              <ul className="mt-1 space-y-1 font-mono text-[10px] text-amber-200/80">
                {snapshot.warnings.slice(0, 6).map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
