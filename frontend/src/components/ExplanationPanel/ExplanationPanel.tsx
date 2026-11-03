import { StatusBadge } from "../common/StatusBadge";

const PLANNED_RULES = [
  ["push / pop", "verify RSP delta and the stored value against before/after snapshots"],
  ["call / ret", "show the saved return location, new RIP and frame change"],
  ["sub rsp, imm", "explain local-space reservation using the measured RSP delta"],
  ["mov dst, src", "report data movement with the affected registers or bytes"],
  ["unrecognised", "show measured before/after state only; never invent semantics"],
];

export function ExplanationPanel() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <StatusBadge tone="idle">phase 4</StatusBadge>
        <span className="text-[11px] text-slate-500">
          Rule-based explanations will cite the real before/after state.
        </span>
      </div>
      <ul className="space-y-1.5 font-mono text-[11px]">
        {PLANNED_RULES.map(([instruction, note]) => (
          <li key={instruction} className="flex gap-3">
            <span className="w-28 shrink-0 text-cyan-300/80">{instruction}</span>
            <span className="text-slate-500">{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
