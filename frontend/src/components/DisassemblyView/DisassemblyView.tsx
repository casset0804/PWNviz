import { memo } from "react";
import { useTranslation } from "react-i18next";

import { compareAddress, normalizeAddress } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";
import { Panel } from "../common/Panel";

interface DisassemblyViewProps {
  onCollapse?: () => void;
}

export const DisassemblyView = memo(function DisassemblyView({
  onCollapse,
}: DisassemblyViewProps) {
  const { t } = useTranslation(["panels", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const session = useDebugStore((state) => state.session);
  const selectedInstructionAddress = useDebugStore(
    (state) => state.selectedInstructionAddress,
  );
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const selectInstruction = useDebugStore((state) => state.selectInstruction);

  const rip = normalizeAddress(snapshot?.registers.rip ?? null);
  const instruction = snapshot?.instruction ?? null;
  const selected = normalizeAddress(selectedInstructionAddress);
  const lines = snapshot?.disassembly ?? [];
  const breakpointAddresses = new Set(
    breakpoints
      .map((breakpoint) => normalizeAddress(breakpoint.address))
      .filter((address): address is string => address !== null),
  );

  return (
    <Panel
      title={t("panels:disassembly.title")}
      hint={t("panels:disassembly.hint")}
      className="min-w-0"
      onCollapse={onCollapse}
      actions={
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[#6f8ba0]">
          <span
            className={`mr-1 inline-block h-1.5 w-1.5 ${rip ? "bg-cyan-400" : "bg-slate-600"}`}
            aria-hidden="true"
          />
          {rip ? t("panels:disassembly.rip") : t("panels:disassembly.noRip")}
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {instruction ? (
          <div className="shrink-0 border-b border-[#1a2431] border-l-2 border-l-cyan-400/60 bg-[#0b131c] px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#b8d9ea]"
                data-testid="current-instruction"
                title={`${instruction.address} ${instruction.text ?? instruction.mnemonic ?? ""}`}
              >
                <span className="text-cyan-300/90">{instruction.address}</span>{" "}
                <span className="text-[#d8e4ef]">
                  {instruction.text ?? instruction.mnemonic}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[9px] text-[#526477]">
                {instruction.bytes ?? "—"}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[9px] text-[#5f7186]">
              <span className="truncate">
                {instruction.function ?? t("panels:disassembly.unknownFunction")}
              </span>
              <span className="text-[#334255]">·</span>
              <span className="truncate">
                {session?.stop_reason ??
                  snapshot?.stop_reason ??
                  t("panels:disassembly.stopped")}
              </span>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
              <span className="border border-[#263447] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#6e8095]">
                {t("panels:disassembly.empty")}
              </span>
              <p className="max-w-xs text-[10px] leading-4 text-[#617186]">
                {t("panels:disassembly.emptyHint")}
              </p>
            </div>
          ) : (
            <div className="py-0.5">
              {lines.map((line) => {
                const lineAddress = normalizeAddress(line.address);
                const isCurrent =
                  Boolean(rip) && lineAddress !== null && compareAddress(lineAddress, rip) === 0;
                const isSelected =
                  Boolean(selected) &&
                  lineAddress !== null &&
                  compareAddress(lineAddress, selected) === 0;
                const hasBreakpoint =
                  lineAddress !== null && breakpointAddresses.has(lineAddress);
                return (
                  <button
                    type="button"
                    key={line.address}
                    data-testid="disassembly-line"
                    data-current={isCurrent ? "true" : "false"}
                    data-selected={isSelected ? "true" : "false"}
                    onClick={() => {
                      if (lineAddress) selectInstruction(line.address);
                    }}
                    title={line.function ? `${line.function} · ${line.text}` : line.text}
                    className={`grid w-full grid-cols-[8.2rem_1.15rem_minmax(0,1fr)] items-center gap-1.5 border-l-2 py-[3px] pr-2 text-left font-mono text-[10px] leading-[15px] transition-colors ${
                      isCurrent
                        ? "border-l-cyan-400/70 bg-cyan-500/[0.055] text-[#c7e8f4]"
                        : "border-l-transparent text-[#9aa9ba] hover:bg-[#111a25] hover:text-[#d5e0eb]"
                    } ${isSelected ? "ring-1 ring-inset ring-amber-400/55" : ""}`}
                  >
                    <span
                      className={`truncate pl-1.5 ${isCurrent ? "text-cyan-300/90" : "text-[#5f7186]"}`}
                    >
                      {line.address}
                    </span>
                    <span className="flex items-center gap-0.5 text-[9px]">
                      {isCurrent ? (
                        <span
                          className="text-cyan-300"
                          title={t("panels:disassembly.currentInstruction")}
                        >
                          ▶
                        </span>
                      ) : null}
                      {hasBreakpoint ? (
                        <span className="text-rose-400" title={t("panels:disassembly.breakpoint")}>
                          ●
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 truncate" title={line.text}>
                      {line.text}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#1a2431] px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.08em] text-[#4d5e72]">
          {t("panels:disassembly.footer")}
        </div>
      </div>
    </Panel>
  );
});
