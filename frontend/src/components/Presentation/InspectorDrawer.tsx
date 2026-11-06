import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { normalizeAddress, parseAddress } from "../../lib/address";
import { explainStep, type Translate } from "../../lib/explain";
import {
  blockAscii,
  blockForAddress,
  blockQword,
  buildStackMap,
  groupMemoryChangesByAddress,
  readSnapshotBytes,
} from "../../lib/stackMap";
import { useDebugStore } from "../../stores/debugStore";

function formatBytes(bytes: Array<string | null>, limit = 32) {
  return bytes.slice(0, limit).map((byte) => ({ value: byte ?? "??", unknown: byte === null }));
}

/**
 * Inspector Drawer (V1.4).
 *
 * The presentation workbench no longer keeps a permanent bottom panel: every
 * detail surface it used to carry — memory diff, selected block detail, raw
 * bytes, QWORD, ASCII, pointer target and the before/after table — slides in
 * here as an overlay when a memory block (or change run) is selected, and
 * closes without taking permanent space. DeveloperWorkbench keeps its full
 * BottomDock instead.
 */
export function InspectorDrawer() {
  const { t } = useTranslation(["panels", "explanation", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const lastAction = useDebugStore((state) => state.lastAction);
  const selectedByteAddress = useDebugStore((state) => state.selectedByteAddress);
  const selectByte = useDebugStore((state) => state.selectByte);
  const clearByteSelection = useDebugStore((state) => state.clearByteSelection);
  const pointerTarget = useDebugStore((state) => state.pointerTarget);

  const translate = useMemo<Translate>(
    () => (key, params) => String(t(`explanation:${key}`, (params ?? {}) as never)),
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

  // The change run containing the selected byte (gutter / marker click).
  const selectedChangeGroup = useMemo(() => {
    if (!selectedByteAddress) return null;
    const selected = parseAddress(selectedByteAddress);
    if (selected === null) return null;
    return (
      groupMemoryChangesByAddress(changedBytes).find((group) => {
        const start = parseAddress(group.start);
        const end = parseAddress(group.end);
        return start !== null && end !== null && selected >= start && selected < end;
      }) ?? null
    );
  }, [changedBytes, selectedByteAddress]);

  if (!snapshot || !selectedByteAddress) return null;

  return (
    <aside
      className="absolute bottom-0 right-0 top-0 z-40 flex w-[400px] max-w-[90vw] flex-col border-l border-[#1b2a3a] bg-[#070d14]/98 shadow-[-8px_0_28px_rgba(0,0,0,0.55)]"
      data-testid="inspector-drawer"
      data-state="open"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[#1b2a3a] bg-[#0a121b] px-3 py-2.5">
        <h2 className="text-[15px] font-semibold text-[#edf5fd]">
          {t("panels:stackMap.detail")}
        </h2>
        <span className="ml-auto font-mono text-[12px] text-[#7f93a8]">
          {selectedBlock?.start ?? selectedByteAddress}
        </span>
        <button
          type="button"
          onClick={clearByteSelection}
          data-testid="inspector-drawer-close"
          aria-label={t("panels:stackMap.closeDetail")}
          className="rounded-sm border border-[#2b3d51] bg-[#0c1520] px-2 py-1 text-[12px] text-[#8fa3b8] hover:border-[#47627e] hover:text-[#d6e4f1]"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        {/* 1. This step's memory diff (the whole measured change set). */}
        <section className="mb-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[13px] font-semibold text-[#dbeaf7]">
              {t("panels:teaching.changeTitle")}
            </h3>
            <span className="font-mono text-[11.5px] text-[#7f93a8]">
              {t("panels:teaching.changedBytes", { count: changedBytes.length })}
            </span>
          </div>
          {changedBytes.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-[#7f93a8]">{t("panels:teaching.noChange")}</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {changedBytes.slice(0, 24).map((change) => (
                <li key={change.address}>
                  <button
                    type="button"
                    onClick={() => selectByte(change.address)}
                    className="flex w-full items-baseline justify-between gap-2 rounded-sm px-1.5 py-1 text-left font-mono text-[12px] transition-colors hover:bg-[#0f1b27]"
                  >
                    <span className="truncate text-[#8fa3b8]">{change.address}</span>
                    <span className="shrink-0">
                      <span className="text-[#6f849a]">{change.before ?? "??"}</span>
                      <span className="mx-1 text-[#485b70]">→</span>
                      <span className="text-emerald-200">{change.after ?? "??"}</span>
                    </span>
                  </button>
                </li>
              ))}
              {changedBytes.length > 24 ? (
                <li className="px-1.5 font-mono text-[11.5px] text-[#5f7388]">
                  +{changedBytes.length - 24} …
                </li>
              ) : null}
            </ul>
          )}
        </section>

        {/* 2. Selected block detail. */}
        <section className="border-t border-[#16232f] pt-2.5" data-testid="selected-block-detail">
          {!selectedBlock && !selectedChangeGroup ? (
            <p className="text-[12.5px] leading-5 text-[#9db0c4]">{t("panels:stackMap.detailEmptyHint")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[15px] font-semibold text-[#e6f0fa]">
                  {selectedBlock?.label ||
                    selectedBlock?.kind ||
                    selectedChangeGroup?.start ||
                    t("panels:stackMap.selected")}
                </span>
                {selectedBlock?.type ? (
                  <span className="font-mono text-[12px] text-[#8fa3b8]">{selectedBlock.type}</span>
                ) : null}
                {selectedBlock ? (
                  <span className="ml-auto rounded-sm border border-[#2b3d51] px-1.5 py-0.5 font-mono text-[11px] text-[#8fa3b8]">
                    {selectedBlock.sizeBytes === null
                      ? t("panels:stackMap.sizeUnknown")
                      : t("panels:stackMap.bytes", { count: selectedBlock.sizeBytes })}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[12px] text-[#8fa3b8]">
                {selectedBlock ? <span>{selectedBlock.start}</span> : null}
                {selectedBlock?.frameOffset ? <span>rbp{selectedBlock.frameOffset}</span> : null}
                {selectedBlock?.variable ? (
                  <span className="text-emerald-200">
                    {selectedBlock.variable.name} = {selectedBlock.variable.value ?? "—"}
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
                    className={`rounded-sm border px-1 py-0.5 font-mono text-[11.5px] ${
                      byte.unknown
                        ? "border-rose-500/30 bg-rose-500/[0.05] text-rose-300"
                        : "border-[#243547] bg-[#0c1520] text-[#c6d6e6]"
                    }`}
                  >
                    {byte.value}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-[#7f93a8]">
                <span>
                  {t("panels:stackMap.qword")}: {qword ?? "—"}
                </span>
                <span>
                  {t("panels:stackMap.ascii")}: {ascii ?? "—"}
                </span>
              </div>
              {pointerTarget ? (
                <div className="mt-2 rounded-sm border border-sky-500/25 bg-sky-500/[0.04] px-2 py-1.5">
                  <div className="text-[11.5px] text-[#a9c8e4]">
                    {t("panels:stackMap.pointerTargetTitle")}: {pointerTarget.variableName}{" "}
                    {normalizeAddress(pointerTarget.address) ?? pointerTarget.address}
                  </div>
                  {pointerTarget.bytes ? (
                    <div className="mt-1 break-all font-mono text-[11px] text-[#8fa3b8]">
                      {pointerTarget.bytes.slice(0, 128)}
                    </div>
                  ) : null}
                  {pointerTarget.stringValue ? (
                    <div className="mt-1 truncate font-mono text-[11px] text-emerald-200">
                      {pointerTarget.stringValue}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* 3. Before/After table for the selected block or change run. */}
              {(selectedBlock?.changedBytes.length ?? 0) > 0 || selectedChangeGroup ? (
                <div className="mt-2.5 border-t border-[#16232f] pt-2" data-testid="selected-block-changes">
                  <div className="text-[11.5px] uppercase tracking-[0.08em] text-[#5f7388]">
                    {t("panels:teaching.changedBytes", {
                      count: selectedBlock?.changedBytes.length ?? selectedChangeGroup?.count ?? 0,
                    })}
                  </div>
                  <table
                    className="mt-1 w-full border-collapse font-mono text-[12px]"
                    data-testid="selected-changes-table"
                  >
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-[#5f7388]">
                        <th className="py-0.5 pr-2 font-medium">Address</th>
                        <th className="py-0.5 pr-2 font-medium">Before</th>
                        <th className="py-0.5 font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedBlock?.changedBytes.length ?? 0) > 0
                        ? selectedBlock?.changedBytes.map((change) => (
                            <tr key={change.address} className="border-t border-[#14212e]">
                              <td className="py-0.5 pr-2 text-[#8fa3b8]">{change.address}</td>
                              <td className="py-0.5 pr-2 text-[#6f849a]">{change.before ?? "??"}</td>
                              <td className="py-0.5 text-emerald-200">{change.after ?? "??"}</td>
                            </tr>
                          ))
                        : selectedChangeGroup?.changes.map((change) => (
                            <tr key={change.address} className="border-t border-[#14212e]">
                              <td className="py-0.5 pr-2 text-[#8fa3b8]">{change.address}</td>
                              <td className="py-0.5 pr-2 text-[#6f849a]">{change.before ?? "??"}</td>
                              <td className="py-0.5 text-emerald-200">{change.after ?? "??"}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* 4. One-line verified explanation for the just-executed step. */}
        <section className="mt-3 border-t border-[#16232f] pt-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-[#dbeaf7]">{t("panels:teaching.title")}</h3>
            <span
              className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${
                explanation.matched && previousSnapshot
                  ? "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-200"
                  : "border-amber-500/35 bg-amber-500/[0.06] text-amber-200"
              }`}
            >
              {explanation.matched && previousSnapshot
                ? t("panels:teaching.verified")
                : t("panels:teaching.unverified")}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[#dbeaf7]">
            {previousSnapshot ? explanation.headline : t("panels:teaching.noChange")}
          </p>
        </section>
      </div>
    </aside>
  );
}
