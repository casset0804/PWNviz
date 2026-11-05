import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { normalizeAddress } from "../../lib/address";
import { explainStep, type Translate } from "../../lib/explain";
import {
  blockAscii,
  blockForAddress,
  blockQword,
  buildStackMap,
  readSnapshotBytes,
} from "../../lib/stackMap";
import { useDebugStore } from "../../stores/debugStore";

function formatBytes(bytes: Array<string | null>, limit = 32): Array<{ value: string; unknown: boolean }> {
  return bytes.slice(0, limit).map((byte) => ({
    value: byte ?? "??",
    unknown: byte === null,
  }));
}

/**
 * Bottom teaching strip: verified step explanation, the real byte diff and the
 * selected memory block. Everything is read from the current snapshot; when a
 * field is unavailable it is shown as unavailable instead of being inferred.
 */
export function StepTeachingPanel() {
  const { t } = useTranslation(["panels", "explanation", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const lastAction = useDebugStore((state) => state.lastAction);
  const selectedByteAddress = useDebugStore((state) => state.selectedByteAddress);
  const selectByte = useDebugStore((state) => state.selectByte);
  const clearByteSelection = useDebugStore((state) => state.clearByteSelection);
  const pointerTarget = useDebugStore((state) => state.pointerTarget);
  const projection = useDebugStore((state) => state.projectionMode);

  const translate = useCallback<Translate>(
    (key, params) => String(t(`explanation:${key}`, (params ?? {}) as never)),
    [t],
  );
  const explanation = useMemo(
    () => explainStep(previousSnapshot, snapshot, lastAction, translate),
    [previousSnapshot, snapshot, lastAction, translate],
  );

  const model = useMemo(() => buildStackMap(snapshot), [snapshot]);
  const selectedBlock = blockForAddress(model, selectedByteAddress);
  const rawBytes = selectedBlock
    ? readSnapshotBytes(snapshot, selectedBlock.start, 32)
    : readSnapshotBytes(snapshot, selectedByteAddress, 32);
  const qword = selectedBlock ? blockQword(snapshot, selectedBlock) : null;
  const ascii = selectedBlock
    ? blockAscii(snapshot, selectedBlock.start)
    : selectedByteAddress
      ? blockAscii(snapshot, selectedByteAddress)
      : null;
  const changedBytes = snapshot?.diff.changed_bytes ?? [];
  const changedRegisters = snapshot?.diff.changed_registers ?? [];

  if (!snapshot) {
    return (
      <section
        className="flex min-h-[148px] shrink-0 items-center rounded-lg border border-[#1b2a3a] bg-[#080f17] px-5 py-4"
        data-testid="teaching-panel"
        data-state="empty"
      >
        <div>
          <h2 className="text-[18px] font-semibold text-[#e5eef8]">{t("panels:teaching.title")}</h2>
          <p className="mt-1 text-[13px] text-[#7f93a8]">{t("panels:teaching.noSnapshotHint")}</p>
        </div>
      </section>
    );
  }

  const executed = previousSnapshot?.instruction ?? null;
  const matched = explanation.matched && Boolean(previousSnapshot);

  if (projection) {
    // Classroom projection: one slim verified-headline strip. Dev details
    // (byte diff lists, register tags, inspector rows) stay out of the way.
    return (
      <section
        className="flex min-h-[64px] shrink-0 items-center gap-3 rounded-lg border border-[#1b2a3a] bg-[#080f17] px-4 py-2"
        data-testid="teaching-panel"
        data-state="projection"
        data-matched={matched ? "true" : "false"}
      >
        <span className="text-[17px] font-semibold text-[#edf5fd]">{t("panels:teaching.title")}</span>
        <span
          className={`rounded-sm border px-1.5 py-0.5 text-[12px] ${
            matched
              ? "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-200"
              : "border-amber-500/35 bg-amber-500/[0.06] text-amber-200"
          }`}
          data-testid="teaching-matched"
        >
          {matched ? t("panels:teaching.verified") : t("panels:teaching.unverified")}
        </span>
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium text-[#e2eefb]" title={explanation.headline}>
          {explanation.headline}
        </p>
        {executed ? (
          <span className="hidden shrink-0 font-mono text-[12.5px] text-[#6f849a] 2xl:inline">
            {t("panels:instruction.previous")}: {executed.text}
          </span>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="grid min-h-[168px] shrink-0 grid-cols-1 gap-2 xl:h-[clamp(150px,14vh,176px)] xl:grid-cols-[1.2fr_1fr_1.15fr]"
      data-testid="teaching-panel"
      data-state="ready"
      data-matched={matched ? "true" : "false"}
    >
      <article className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#1b2a3a] bg-[#080f17]">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#1b2a3a] bg-[#0a121b] px-4 py-2.5">
          <h2 className="text-[17px] font-semibold text-[#edf5fd]">{t("panels:teaching.title")}</h2>
          <span
            className={`rounded-sm border px-1.5 py-0.5 text-[12px] ${
              matched
                ? "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-200"
                : "border-amber-500/35 bg-amber-500/[0.06] text-amber-200"
            }`}
            data-testid="teaching-matched"
          >
            {matched ? t("panels:teaching.verified") : t("panels:teaching.unverified")}
          </span>
          <span className="ml-auto font-mono text-[12px] text-[#5f7388]">
            {t("panels:teaching.action")}: {lastAction ?? "—"}
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2.5">
          <p className="text-[15px] font-medium leading-6 text-[#e2eefb]">{explanation.headline}</p>
          {explanation.lines.slice(0, 3).map((line) => (
            <p key={line} className="mt-1 text-[13px] leading-5 text-[#9db0c4]">
              {line}
            </p>
          ))}
          {executed ? (
            <p className="mt-1.5 truncate font-mono text-[12px] text-[#6f849a]">
              {t("panels:instruction.previous")}: {executed.text}
            </p>
          ) : null}
        </div>
      </article>

      <article className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#1b2a3a] bg-[#080f17]">
        <header className="flex shrink-0 items-center gap-2 border-b border-[#1b2a3a] bg-[#0a121b] px-4 py-2.5">
          <h2 className="text-[17px] font-semibold text-[#edf5fd]">{t("panels:teaching.changeTitle")}</h2>
          <span className="ml-auto font-mono text-[12px] text-[#7f93a8]">
            {t("panels:teaching.changedBytes", { count: changedBytes.length })}
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {changedBytes.length === 0 ? (
            <p className="px-1 py-2 text-[13px] text-[#7f93a8]">{t("panels:teaching.noChange")}</p>
          ) : (
            <ul className="space-y-0.5">
              {changedBytes.slice(0, 6).map((change) => (
                <li key={change.address}>
                  <button
                    type="button"
                    onClick={() => selectByte(change.address)}
                    className="flex w-full items-baseline justify-between gap-2 rounded-sm px-2 py-1 text-left font-mono text-[12px] transition-colors hover:bg-[#0f1b27]"
                  >
                    <span className="truncate text-[#8fa3b8]">{change.address}</span>
                    <span className="shrink-0">
                      <span className="text-[#6f849a]">{change.before ?? "??"}</span>
                      <span className="mx-1.5 text-[#485b70]">→</span>
                      <span className="text-emerald-200">{change.after ?? "??"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 border-t border-[#16232f] pt-2">
            <div className="text-[12.5px] uppercase tracking-[0.08em] text-[#5f7388]">
              {t("panels:teaching.changedRegisterTitle")}
            </div>
            {changedRegisters.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-[#7f93a8]">
                {t("panels:teaching.changedRegisterNone")}
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {changedRegisters.slice(0, 10).map((register) => (
                  <span
                    key={register}
                    className="rounded-sm border border-[#2b3d51] bg-[#0c1520] px-1.5 py-0.5 font-mono text-[12.5px] text-[#b9c8d8]"
                  >
                    {register.toUpperCase()}{" "}
                    <span className="text-[#7f93a8]">{snapshot.registers[register] ?? "—"}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </article>

      <article className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#1b2a3a] bg-[#080f17]">
        <header className="flex shrink-0 items-center gap-2 border-b border-[#1b2a3a] bg-[#0a121b] px-4 py-2.5">
          <h2 className="text-[17px] font-semibold text-[#edf5fd]">{t("panels:stackMap.detail")}</h2>
          <span className="ml-auto font-mono text-[12px] text-[#7f93a8]">
            {selectedBlock?.start ?? selectedByteAddress ?? "—"}
          </span>
          {selectedByteAddress ? (
            <button
              type="button"
              onClick={clearByteSelection}
              className="rounded-sm border border-[#2b3d51] bg-[#0c1520] px-1.5 py-0.5 text-[12px] text-[#8fa3b8] hover:border-[#47627e]"
            >
              {t("panels:teaching.clearSelection")}
            </button>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2.5" data-testid="selected-block-detail">
          {!selectedBlock && !selectedByteAddress ? (
            <>
              <p className="text-[13px] text-[#9db0c4]">{t("panels:stackMap.detailEmpty")}</p>
              <p className="mt-1 text-[12px] leading-5 text-[#6f849a]">
                {t("panels:stackMap.detailEmptyHint")}
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[15px] font-semibold text-[#e6f0fa]">
                  {selectedBlock?.label || selectedBlock?.kind || t("panels:stackMap.selected")}
                </span>
                {selectedBlock?.type ? (
                  <span className="font-mono text-[12px] text-[#8fa3b8]">{selectedBlock.type}</span>
                ) : null}
                {selectedBlock ? (
                  <span className="ml-auto rounded-sm border border-[#2b3d51] px-1.5 py-0.5 font-mono text-[12px] text-[#8fa3b8]">
                    {selectedBlock.sizeBytes === null
                      ? t("panels:stackMap.sizeUnknown")
                      : t("panels:stackMap.bytes", { count: selectedBlock.sizeBytes })}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[12px] text-[#8fa3b8]">
                {selectedBlock ? <span>{selectedBlock.start}</span> : null}
                {selectedBlock?.variable ? (
                  <span className="text-emerald-200">
                    {t("panels:variables.kindValue")}: {selectedBlock.variable.value ?? "—"}
                  </span>
                ) : null}
                {selectedBlock?.value && !selectedBlock.variable ? (
                  <span className="text-[#c8d8e8]">{selectedBlock.value}</span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {formatBytes(rawBytes).map((byte, index) => (
                  <span
                    key={`${index}:${byte.value}`}
                    className={`rounded-sm border px-1 py-0.5 font-mono text-[12.5px] ${
                      byte.unknown
                        ? "border-rose-500/30 bg-rose-500/[0.05] text-rose-300"
                        : "border-[#243547] bg-[#0c1520] text-[#c6d6e6]"
                    }`}
                  >
                    {byte.value}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12.5px] text-[#7f93a8]">
                <span>
                  {t("panels:stackMap.qword")}: {qword ?? "—"}
                </span>
                <span>
                  {t("panels:stackMap.ascii")}: {ascii ?? "—"}
                </span>
              </div>
              {(selectedBlock?.changedBytes.length ?? 0) > 0 ? (
                <div className="mt-2 border-t border-[#16232f] pt-2" data-testid="selected-block-changes">
                  <div className="text-[11.5px] uppercase tracking-[0.08em] text-[#5f7388]">
                    {t("panels:teaching.changedBytes", {
                      count: selectedBlock?.changedBytes.length ?? 0,
                    })}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {selectedBlock?.changedBytes.map((change) => (
                      <li
                        key={change.address}
                        className="flex items-baseline justify-between gap-2 font-mono text-[12px]"
                      >
                        <span className="truncate text-[#8fa3b8]">{change.address}</span>
                        <span className="shrink-0">
                          <span className="text-[#6f849a]">{change.before ?? "??"}</span>
                          <span className="mx-1.5 text-[#485b70]">→</span>
                          <span className="text-emerald-200">{change.after ?? "??"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {pointerTarget ? (
                <div className="mt-2 rounded-sm border border-sky-500/25 bg-sky-500/[0.04] px-2 py-1.5">
                  <div className="text-[12.5px] text-[#a9c8e4]">
                    {t("panels:stackMap.pointerTargetTitle")}: {pointerTarget.variableName}{" "}
                    {normalizeAddress(pointerTarget.address) ?? pointerTarget.address}
                  </div>
                  {pointerTarget.bytes ? (
                    <div className="mt-1 break-all font-mono text-[12px] text-[#8fa3b8]">
                      {pointerTarget.bytes.slice(0, 128)}
                    </div>
                  ) : null}
                  {pointerTarget.stringValue ? (
                    <div className="mt-1 truncate font-mono text-[12px] text-emerald-200">
                      {pointerTarget.stringValue}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </article>
    </section>
  );
}
