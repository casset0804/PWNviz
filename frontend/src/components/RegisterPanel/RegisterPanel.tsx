import { previousRegisterValue } from "../../lib/snapshot";
import { useDebugStore } from "../../stores/debugStore";
import { Panel } from "../common/Panel";
import { StatusBadge } from "../common/StatusBadge";

const REGISTER_GROUPS: Array<{ title: string; registers: string[] }> = [
  { title: "pointers", registers: ["RIP", "RSP", "RBP"] },
  { title: "general", registers: ["RAX", "RBX", "RCX", "RDX", "RSI", "RDI"] },
  {
    title: "extended",
    registers: ["R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15"],
  },
  { title: "flags", registers: ["EFLAGS"] },
];

export function RegisterPanel() {
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const requestScroll = useDebugStore((state) => state.requestScroll);
  const session = useDebugStore((state) => state.session);

  const changed = new Set(snapshot?.diff.changed_registers ?? []);

  return (
    <Panel
      title="Registers"
      hint="x86-64 · live GDB values"
      className="min-w-0"
      actions={
        <StatusBadge tone={snapshot ? "ok" : "idle"}>
          {snapshot ? "stopped" : session ? "running" : "no values"}
        </StatusBadge>
      }
    >
      <div className="space-y-4 p-3">
        {REGISTER_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">
              {group.title}
            </h3>
            <ul className="space-y-0.5">
              {group.registers.map((register) => {
                const key = register.toLowerCase();
                const value = snapshot?.registers[key] ?? null;
                const before = previousRegisterValue(snapshot, previousSnapshot, key);
                const isChanged = changed.has(key);
                const isMarker = register === "RSP" || register === "RBP";
                return (
                  <li key={register}>
                    <button
                      type="button"
                      data-testid={`register-${key}`}
                      data-value={value ?? ""}
                      data-changed={isChanged ? "true" : "false"}
                      onClick={() => {
                        if (isMarker && value) requestScroll(value);
                      }}
                      disabled={!isMarker || !value}
                      title={
                        isMarker && value
                          ? `Scroll Stack Memory to ${register} ${value}`
                          : `${register} from the current GDB snapshot`
                      }
                      className={`flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left font-mono text-[11px] odd:bg-[#0f141d] ${
                        isMarker
                          ? "cursor-pointer hover:bg-[#16202e]"
                          : "cursor-default disabled:cursor-default"
                      } ${isChanged ? "bg-emerald-500/5" : ""}`}
                    >
                      <span
                        className={`shrink-0 ${
                          register === "RIP"
                            ? "text-cyan-300"
                            : register === "RSP"
                              ? "text-orange-300"
                              : register === "RBP"
                                ? "text-sky-300"
                                : "text-slate-400"
                        }`}
                      >
                        {register}
                      </span>
                      <span className="min-w-0 text-right">
                        {isChanged ? (
                          <span className="mr-1 text-[9px] text-slate-500" title="before → after">
                            {before ?? "?"} →
                          </span>
                        ) : null}
                        <span
                          className={`${isChanged ? "text-emerald-200" : "text-slate-200"} ${
                            value ? "" : "text-slate-700"
                          }`}
                        >
                          {value ?? "—"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="space-y-1 border-t border-[#1e2635] pt-2 text-[10px] leading-5 text-slate-600">
          <p>
            Values are read from a live GDB/MI3 session and rendered as hex strings.
            Addresses never become JavaScript numbers.
          </p>
          <p>Click RSP/RBP to scroll the stack canvas to that exact address.</p>
        </div>
      </div>
    </Panel>
  );
}
