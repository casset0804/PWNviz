import { memo } from "react";
import { useTranslation } from "react-i18next";

import { previousRegisterValue } from "../../lib/snapshot";
import { useDebugStore } from "../../stores/debugStore";
import { Panel } from "../common/Panel";

const REGISTER_GROUPS: Array<{ key: string; registers: string[] }> = [
  { key: "pointers", registers: ["RIP", "RSP", "RBP"] },
  { key: "general", registers: ["RAX", "RBX", "RCX", "RDX", "RSI", "RDI"] },
  {
    key: "extended",
    registers: ["R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15"],
  },
  { key: "flags", registers: ["EFLAGS"] },
];

function registerTone(register: string): { text: string; border: string; bg: string } {
  switch (register) {
    case "RIP":
      return { text: "text-cyan-300", border: "border-l-cyan-400/60", bg: "bg-cyan-500/[0.035]" };
    case "RSP":
      return { text: "text-[#f6ad55]", border: "border-l-[#f6ad55]/70", bg: "bg-orange-500/[0.035]" };
    case "RBP":
      return { text: "text-[#7db8e8]", border: "border-l-[#7db8e8]/60", bg: "bg-sky-500/[0.03]" };
    default:
      return { text: "text-[#8ea0b4]", border: "border-l-transparent", bg: "" };
  }
}

interface RegisterPanelProps {
  onCollapse?: () => void;
}

export const RegisterPanel = memo(function RegisterPanel({
  onCollapse,
}: RegisterPanelProps) {
  const { t } = useTranslation(["panels", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const requestScroll = useDebugStore((state) => state.requestScroll);
  const session = useDebugStore((state) => state.session);

  const changed = new Set(snapshot?.diff.changed_registers ?? []);

  return (
    <Panel
      title={t("panels:registers.title")}
      hint={t("panels:registers.hint")}
      className="min-w-0"
      onCollapse={onCollapse}
      actions={
        <span className="inline-flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#66788c]">
          <span
            className={`h-1.5 w-1.5 ${snapshot ? "bg-emerald-400" : "bg-slate-600"}`}
            aria-hidden="true"
          />
          {snapshot
            ? t("panels:registers.stopped")
            : session
              ? t("panels:registers.running")
              : t("panels:registers.noValues")}
        </span>
      }
    >
      <div className="space-y-2.5 p-2">
        {REGISTER_GROUPS.map((group) => (
          <div key={group.key}>
            <h3 className="mb-1 flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.18em] text-[#4e5f73]">
              <span>{t(`panels:registers.${group.key}`)}</span>
              <span className="h-px flex-1 bg-[#151f2b]" aria-hidden="true" />
            </h3>
            <ul>
              {group.registers.map((register) => {
                const key = register.toLowerCase();
                const value = snapshot?.registers[key] ?? null;
                const before = previousRegisterValue(snapshot, previousSnapshot, key);
                const isChanged = changed.has(key);
                const isMarker = register === "RSP" || register === "RBP";
                const tone = registerTone(register);
                return (
                  <li key={register} className={`border-l-2 ${tone.border}`}>
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
                          ? t("panels:registers.centerTitle", {
                              register,
                              value,
                            })
                          : t("panels:registers.snapshotTitle", { register })
                      }
                      className={`w-full px-1.5 py-[3px] text-left font-mono text-[10px] leading-[14px] transition-colors odd:bg-[#0e151e] ${
                        isMarker
                          ? `cursor-pointer hover:bg-[#141f2b] ${tone.bg}`
                          : "cursor-default disabled:cursor-default"
                      } ${isChanged ? "border-l-2 border-l-emerald-400/70 bg-emerald-500/[0.035]" : ""}`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`shrink-0 ${tone.text}`}>{register}</span>
                        <span
                          className={`min-w-0 text-right ${
                            isChanged
                              ? "text-emerald-200"
                              : value
                                ? "text-[#c4d1de]"
                                : "text-[#3f4c5c]"
                          }`}
                        >
                          {value ?? "—"}
                        </span>
                      </span>
                      {isChanged ? (
                        <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[8px]">
                          <span className="uppercase tracking-[0.1em] text-emerald-400/70">
                            {t("panels:registers.changed")}
                          </span>
                          <span
                            className="min-w-0 truncate text-[#5c6d80]"
                            title={t("panels:registers.was", {
                              value: before ?? "?",
                            })}
                          >
                            {t("panels:registers.was", { value: before ?? "?" })}
                          </span>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="border-t border-[#1a2431] pt-1.5 font-mono text-[8px] leading-4 text-[#4e5f73]">
          {t("panels:registers.footer")}
        </div>
      </div>
    </Panel>
  );
});
