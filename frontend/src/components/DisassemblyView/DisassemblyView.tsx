import { Panel } from "../common/Panel";
import { StatusBadge } from "../common/StatusBadge";

export function DisassemblyView() {
  return (
    <Panel title="Disassembly" hint="RIP neighbourhood" className="min-w-0">
      <div className="flex h-full flex-col gap-4 p-4">
        <StatusBadge tone="idle">no session</StatusBadge>
        <div className="rounded border border-dashed border-[#263044] bg-[#0a0e14] p-4">
          <p className="font-mono text-xs leading-6 text-slate-500">
            No disassembly yet. This panel will list real instructions from
            GDB&apos;s <span className="text-slate-300">-data-disassemble</span>{" "}
            around RIP, with machine-code bytes and the current instruction
            highlighted.
          </p>
        </div>
        <div className="space-y-1 font-mono text-[11px] text-slate-700">
          {["address", "bytes", "mnemonic operands"].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between border-b border-[#151c27] pb-1"
            >
              <span>{row}</span>
              <span className="text-slate-800">awaiting snapshot</span>
            </div>
          ))}
        </div>
        <p className="mt-auto text-[10px] leading-5 text-slate-600">
          Phase 1 requirement: an instruction is only shown after GDB has reported
          a stopped event; nothing here is pre-baked sample data.
        </p>
      </div>
    </Panel>
  );
}
