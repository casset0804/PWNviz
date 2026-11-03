import { Panel } from "../common/Panel";
import { StatusBadge } from "../common/StatusBadge";

const REGISTER_GROUPS: Array<{ title: string; registers: string[] }> = [
  { title: "pointers", registers: ["RIP", "RSP", "RBP"] },
  { title: "general", registers: ["RAX", "RBX", "RCX", "RDX", "RSI", "RDI"] },
  { title: "extended", registers: ["R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15"] },
  { title: "flags", registers: ["EFLAGS"] },
];

export function RegisterPanel() {
  return (
    <Panel
      title="Registers"
      hint="x86-64"
      className="min-w-0"
      actions={<StatusBadge tone="idle">no values</StatusBadge>}
    >
      <div className="space-y-5 p-3">
        {REGISTER_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">
              {group.title}
            </h3>
            <ul className="space-y-0.5">
              {group.registers.map((register) => (
                <li
                  key={register}
                  className="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 font-mono text-[11px] odd:bg-[#0f141d]"
                >
                  <span className="text-slate-400">{register}</span>
                  <span className="text-slate-700" aria-label="no value">
                    —
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-[10px] leading-5 text-slate-600">
          Values will be read from a live GDB/MI3 session via{" "}
          <span className="text-slate-500">-data-list-register-values x</span> and
          rendered as hex strings. Addresses are never converted to JavaScript
          numbers, and this panel never displays invented values.
        </p>
      </div>
    </Panel>
  );
}
