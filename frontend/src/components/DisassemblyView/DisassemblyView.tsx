import { compareAddress, normalizeAddress } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";
import { Panel } from "../common/Panel";
import { StatusBadge } from "../common/StatusBadge";

export function DisassemblyView() {
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
      title="Disassembly"
      hint="RIP neighbourhood"
      className="min-w-0"
      actions={
        <StatusBadge tone={rip ? "info" : "idle"}>
          {rip ? `rip ${rip.slice(0, 10)}…` : "no rip"}
        </StatusBadge>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {instruction ? (
          <div className="shrink-0 border-b border-[#1e2635] bg-[#0a0e14] px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] text-cyan-300" data-testid="current-instruction">
                {instruction.address}{" "}
                <span className="text-slate-200">{instruction.text ?? instruction.mnemonic}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-slate-600">
                {instruction.bytes ?? "bytes unavailable"}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-slate-600">
              <span>{instruction.function ?? "unknown function"}</span>
              <span>·</span>
              <span>{session?.stop_reason ?? snapshot?.stop_reason ?? "stopped"}</span>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
              <StatusBadge tone="idle">no disassembly</StatusBadge>
              <p className="max-w-xs text-[11px] leading-5 text-slate-500">
                Launch a sample and stop at <span className="font-mono">main</span> to see real
                instructions around RIP.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {lines.map((line) => {
                const lineAddress = normalizeAddress(line.address);
                const isCurrent =
                  Boolean(rip) && lineAddress !== null && compareAddress(lineAddress, rip) === 0;
                const isSelected =
                  Boolean(selected) && lineAddress !== null && compareAddress(lineAddress, selected) === 0;
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
                    className={`flex w-full items-baseline gap-2 px-3 py-[3px] text-left font-mono text-[11px] transition-colors ${
                      isCurrent
                        ? "bg-cyan-500/10 text-cyan-200"
                        : "text-slate-400 hover:bg-[#131a26] hover:text-slate-200"
                    } ${isSelected ? "ring-1 ring-inset ring-amber-500/60" : ""}`}
                  >
                    <span className={`w-[8.5rem] shrink-0 ${isCurrent ? "text-cyan-300" : "text-slate-600"}`}>
                      {line.address}
                    </span>
                    <span className="w-2 shrink-0 text-rose-400" title={hasBreakpoint ? "breakpoint" : undefined}>
                      {hasBreakpoint ? "●" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={line.text}>
                      {line.text}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#1e2635] px-3 py-1.5 text-[10px] leading-4 text-slate-600">
          Click a line to select it. Breakpoints are not created from this panel yet.
        </div>
      </div>
    </Panel>
  );
}
