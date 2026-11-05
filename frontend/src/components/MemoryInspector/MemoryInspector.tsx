import { useTranslation } from "react-i18next";

import { useDebugStore } from "../../stores/debugStore";
import { changedBytesMap, findCell } from "../../lib/snapshot";
import { addressInWindow } from "../../lib/address";
import { StatusBadge } from "../common/StatusBadge";

export function MemoryInspector() {
  const { t } = useTranslation(["panels", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const selectedAddress = useDebugStore((state) => state.selectedByteAddress);
  const pointerTarget = useDebugStore((state) => state.pointerTarget);
  const selectedInstructionAddress = useDebugStore(
    (state) => state.selectedInstructionAddress,
  );

  const cell = findCell(snapshot, selectedAddress);
  const changed = changedBytesMap(snapshot);
  const change = cell ? changed.get(cell.address) : undefined;
  const selectedInstruction =
    snapshot?.instruction &&
    selectedInstructionAddress &&
    snapshot.instruction.address === selectedInstructionAddress
      ? snapshot.instruction
      : snapshot?.disassembly.find(
          (line) => line.address === selectedInstructionAddress,
        ) ?? null;

  return (
    <div className="space-y-2 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={cell ? "ok" : "idle"}>
          {cell ? t("panels:inspector.byteSelected") : t("panels:inspector.noCell")}
        </StatusBadge>
        <span className="text-[10px] text-[#6b7c90]">
          {t("panels:inspector.hint")}
        </span>
      </div>

      {!snapshot ? (
        <p className="font-mono text-[10px] text-[#5d6e82]">
          {t("panels:inspector.noSnapshot")}
        </p>
      ) : null}

      {!cell && snapshot ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-1 border-l-2 border-[#33465c] bg-[#0b121b] px-2.5 py-2 font-mono text-[9px] md:grid-cols-4">
          <span className="text-[#5d6e82]">
            {t("panels:inspector.rip")}{" "}
            <span className="text-[#a9d8ee]">{snapshot.registers.rip ?? "—"}</span>
          </span>
          <span className="text-[#5d6e82]">
            {t("panels:inspector.rsp")}{" "}
            <span className="text-[#f6ad55]">{snapshot.registers.rsp ?? "—"}</span>
          </span>
          <span className="text-[#5d6e82]">
            {t("panels:inspector.rbp")}{" "}
            <span className="text-[#7db8e8]">{snapshot.registers.rbp ?? "—"}</span>
          </span>
          <span className="text-[#5d6e82]">
            {t("panels:inspector.stack")}{" "}
            <span className="text-[#8da0b5]">
              {snapshot.stack.range_start ?? "—"} .. {snapshot.stack.range_end ?? "—"}
            </span>
          </span>
          <span className="col-span-full text-[8px] uppercase tracking-[0.08em] text-[#4e5f73]">
            {t("panels:inspector.clickHint")}
          </span>
        </div>
      ) : null}

      {pointerTarget ? (
        <section className="border-l-2 border-sky-400/50 bg-[#08131b] p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-sky-300/80">
              {t("panels:inspector.pointerTarget")}
            </span>
            <span className="font-mono text-[11px] text-slate-200">
              {pointerTarget.variableName}: {pointerTarget.type}
            </span>
            <StatusBadge
              tone={
                pointerTarget.readable === true
                  ? "ok"
                  : pointerTarget.readable === false
                    ? "error"
                    : "idle"
              }
            >
              {pointerTarget.readable === true
                ? t("panels:inspector.readable")
                : pointerTarget.readable === false
                  ? t("panels:inspector.invalid")
                  : t("panels:inspector.notRead")}
            </StatusBadge>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="font-mono text-[10px] text-slate-400">
              {t("panels:inspector.address")}:{" "}
              {pointerTarget.address ?? t("panels:inspector.unreadable")}
              <br />
              {t("panels:inspector.source")}:{" "}
              {pointerTarget.source ?? t("panels:inspector.unknown")}
            </div>
            <div className="min-w-0 font-mono text-[10px] text-slate-400">
              {t("panels:inspector.string")}: {pointerTarget.stringValue ?? "—"}
            </div>
          </div>
          {pointerTarget.bytes ? (
            <div className="mt-2 break-all font-mono text-[10px] text-slate-300">
              {t("panels:inspector.bytes")}: {pointerTarget.bytes}
            </div>
          ) : null}
          <p className="mt-1 text-[9px] text-slate-500">
            {t("panels:inspector.pointerBody")}
          </p>
        </section>
      ) : null}

      {cell ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="border-l-2 border-[#33465c] bg-[#0b121b] p-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              {t("panels:inspector.address")}
            </div>
            <div
              className="mt-1 break-all font-mono text-[12px] text-cyan-200"
              data-testid="inspector-address"
            >
              {cell.address}
            </div>
            <div className="mt-2 text-[10px] text-slate-600">
              {t("panels:inspector.byteOffset", {
                offset: cell.offset,
                row: cell.row.address,
              })}
            </div>
          </div>
          <div className="border-l-2 border-[#33465c] bg-[#0b121b] p-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              {t("panels:inspector.byte")}
            </div>
            <div
              className={`mt-1 font-mono text-[18px] ${
                cell.byte === null ? "text-rose-300" : "text-slate-100"
              }`}
              data-testid="inspector-byte"
            >
              {cell.byte ?? t("panels:inspector.unreadable")}
            </div>
            <div className="mt-2 text-[10px] text-slate-600">
              {cell.byte === null
                ? t("panels:inspector.byteUnknownHint")
                : t("panels:inspector.decimal", {
                    value: parseInt(cell.byte, 16),
                  })}
            </div>
          </div>
          <div className="border-l-2 border-[#33465c] bg-[#0b121b] p-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              {t("panels:inspector.qwordLe")}
            </div>
            <div className="mt-1 break-all font-mono text-[12px] text-slate-200">
              {cell.row.qword_le ?? t("panels:inspector.unreadable")}
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-slate-600" title={cell.row.ascii ?? ""}>
              {t("panels:inspector.ascii")} {cell.row.ascii ?? t("panels:inspector.unreadable")}
            </div>
          </div>
          <div className="border-l-2 border-[#33465c] bg-[#0b121b] p-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              {t("panels:inspector.rowDiff")}
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-300">
              {cell.row.readable
                ? t("panels:inspector.readableRow")
                : t("panels:inspector.unknownBytes")}
            </div>
            <div className="mt-1 font-mono text-[10px] text-slate-500">
              {t("panels:inspector.rowRange", { address: cell.row.address })}
            </div>
            {change ? (
              <div className="mt-2 font-mono text-[10px] text-emerald-300">
                {change.before ?? t("common:unknown")} →{" "}
                {change.after ?? t("common:unknown")}
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-slate-600">
                {t("panels:inspector.unchanged")}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {selectedInstruction ? (
        <div
          className="border-l-2 border-amber-500/40 bg-amber-500/[0.035] p-2.5"
          data-testid="selected-instruction"
        >
          <div className="text-[10px] uppercase tracking-[0.14em] text-amber-300/80">
            {t("panels:inspector.selectedInstruction")}
          </div>
          <div className="mt-1 font-mono text-[12px] text-slate-200">
            {selectedInstruction.address} · {selectedInstruction.text}
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {t("panels:inspector.selectionOnly")}
          </div>
        </div>
      ) : null}

      {cell &&
      !addressInWindow(
        cell.address,
        snapshot?.stack.range_start ?? null,
        snapshot?.stack.range_end ?? null,
      ) ? (
        <p className="font-mono text-[10px] text-rose-300">
          {t("panels:inspector.outsideWindow")}
        </p>
      ) : null}

      {snapshot?.warnings.length ? (
        <ul className="space-y-1 border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-[10px] text-amber-200/80">
          {snapshot.warnings.slice(0, 5).map((warning) => (
            <li key={warning}>• {warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
