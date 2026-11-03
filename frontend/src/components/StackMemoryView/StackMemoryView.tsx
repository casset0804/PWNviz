import { Panel } from "../common/Panel";
import { StatusBadge } from "../common/StatusBadge";

const LEGEND = [
  { label: "RSP", note: "stack pointer", tone: "text-orange-300", glyph: "RSP" },
  { label: "RBP", note: "frame pointer (when used)", tone: "text-sky-300", glyph: "RBP" },
  { label: "RIP", note: "instruction pointer target", tone: "text-cyan-300", glyph: "RIP" },
  { label: "changed", note: "byte differs from previous snapshot", tone: "text-emerald-300", glyph: "+" },
] as const;

export function StackMemoryView() {
  return (
    <Panel
      title="Stack memory"
      hint="high address on top, low address at bottom"
      className="min-w-0"
      actions={<StatusBadge tone="idle">0 snapshots</StatusBadge>}
    >
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-slate-500">
          {LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`rounded border border-current/30 px-1 ${item.tone}`}
              >
                {item.glyph}
              </span>
              <span className="text-slate-400">{item.label}</span>
              <span className="text-slate-600">{item.note}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-1 flex-col justify-between rounded border border-dashed border-[#263044] bg-[#0a0e14] p-3">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-slate-600">
            <span>higher address</span>
            <span>stack grows downward</span>
          </div>

          <div className="my-3 space-y-1">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="grid grid-cols-[8.5rem_repeat(8,minmax(0,1fr))_5.5rem] items-center gap-1"
              >
                <span className="font-mono text-[10px] text-slate-800">
                  0x????????????
                </span>
                {Array.from({ length: 8 }).map((__, cell) => (
                  <span
                    key={cell}
                    className="h-6 rounded-sm border border-[#151c27] bg-[#0c1119]"
                  />
                ))}
                <span className="font-mono text-[10px] text-slate-800">qword</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-slate-600">
            <span>lower address</span>
            <span>8 bytes per row · little-endian</span>
          </div>
        </div>

        <div className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
          <p className="text-[11px] leading-5 text-slate-400">
            <span className="font-semibold text-slate-300">No snapshot loaded.</span>{" "}
            The grid above shows the planned layout only — addresses and bytes are
            placeholders, not debug data. Once Phase 1 connects a real GDB session,
            each row will carry a real address, 8 real byte cells, the little-endian
            qword, ASCII text, and RSP/RBP/RIP markers derived from live registers.
          </p>
        </div>
      </div>
    </Panel>
  );
}
