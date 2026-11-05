import { memo } from "react";
import { useTranslation } from "react-i18next";

import { previousRegisterValue } from "../../lib/snapshot";
import { useDebugStore } from "../../stores/debugStore";

const CORE = [
  { register: "RIP", key: "rip", tone: "cyan", role: "rip" as const },
  { register: "RSP", key: "rsp", tone: "orange", role: "stack" as const },
  { register: "RBP", key: "rbp", tone: "blue", role: "base" as const },
  { register: "RAX", key: "rax", tone: "neutral", role: "value" as const },
];

const OTHER = ["RBX", "RCX", "RDX", "RSI", "RDI", "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15", "EFLAGS"];

const TONES: Record<string, { border: string; text: string; glow: string }> = {
  cyan: {
    border: "border-cyan-500/35 hover:border-cyan-400/65",
    text: "text-cyan-200",
    glow: "bg-cyan-500/[0.06]",
  },
  orange: {
    border: "border-[#f6ad55]/35 hover:border-[#f6ad55]/70",
    text: "text-[#ffcf94]",
    glow: "bg-[#f6ad55]/[0.055]",
  },
  blue: {
    border: "border-[#7db8e8]/35 hover:border-[#7db8e8]/70",
    text: "text-[#b9d9f2]",
    glow: "bg-[#7db8e8]/[0.05]",
  },
  neutral: {
    border: "border-[#2b3d51] hover:border-[#47627e]",
    text: "text-[#d3e1ef]",
    glow: "bg-[#c9d8e7]/[0.025]",
  },
};

/**
 * Presentation-mode core register cards: RIP, RSP, RBP, RAX first, everything
 * else folded. Clicking RSP/RBP uses the shared scroll target so the stack map
 * and the register card can never disagree about the address.
 */
export const CoreRegisters = memo(function CoreRegisters() {
  const { t } = useTranslation(["panels", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const session = useDebugStore((state) => state.session);
  const requestScroll = useDebugStore((state) => state.requestScroll);
  const selectInstruction = useDebugStore((state) => state.selectInstruction);
  const setWorkbenchMode = useDebugStore((state) => state.setWorkbenchMode);
  const projection = useDebugStore((state) => state.projectionMode);
  const changed = new Set(snapshot?.diff.changed_registers ?? []);

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[#1b2a3a] bg-[#080f17]"
      data-testid="core-registers"
      aria-label={t("panels:registers.coreTitle")}
    >
      <header className="shrink-0 border-b border-[#1b2a3a] bg-[#0a121b] px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[19px] font-semibold text-[#edf5fd]">
            {t("panels:registers.coreTitle")}
          </h2>
          <span className="font-mono text-[12.5px] uppercase tracking-[0.08em] text-[#5f7388]">
            {t("panels:registers.liveValues")}
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-[#7f93a8]">{t("panels:registers.coreHint")}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        <div className="flex flex-col gap-2">
          {CORE.map((entry) => {
            const value = snapshot?.registers[entry.key] ?? null;
            const before = previousRegisterValue(snapshot, previousSnapshot, entry.key);
            const isChanged = changed.has(entry.key);
            const tone = TONES[entry.tone];
            const interactive = entry.role === "stack" || entry.role === "base" || entry.role === "rip";
            return (
              <button
                key={entry.key}
                type="button"
                data-testid={`register-${entry.key}`}
                data-value={value ?? ""}
                data-changed={isChanged ? "true" : "false"}
                disabled={!interactive || !value}
                onClick={() => {
                  if (!value) return;
                  if (entry.role === "stack" || entry.role === "base") {
                    requestScroll(value);
                  } else if (entry.role === "rip") {
                    selectInstruction(value);
                  }
                }}
                title={
                  interactive && value
                    ? t("panels:registers.centerTitle", { register: entry.register, value })
                    : t("panels:registers.snapshotTitle", { register: entry.register })
                }
                className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-all duration-150 ${tone.border} ${tone.glow} disabled:cursor-default`}
              >
                <span className="flex w-12 shrink-0 flex-col">
                  <span className={`font-mono text-[13px] font-semibold tracking-[0.04em] ${tone.text}`}>
                    {entry.register}
                  </span>
                  {isChanged ? (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] uppercase tracking-[0.06em] text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {t("panels:registers.changed")}
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col items-end gap-0.5">
                  <span
                    className={`w-full truncate text-right font-mono text-[18px] font-semibold tabular-nums ${
                      isChanged ? "text-emerald-100" : value ? "text-[#eef6ff]" : "text-[#4b5e72]"
                    }`}
                    title={value ?? undefined}
                  >
                    {value ?? "—"}
                  </span>
                  <span className="w-full truncate text-right font-mono text-[12px] text-[#6f849a]">
                    {isChanged && before
                      ? t("panels:registers.previous", { value: before })
                      : value
                        ? t("panels:registers.unchanged")
                        : t("panels:registers.noValues")}
                  </span>
                </span>
                {entry.role === "stack" || entry.role === "base" ? (
                  <span className="shrink-0 rounded-sm border border-[#33475c] bg-[#0c1520] px-1.5 py-1 text-[11.5px] font-medium text-[#9db1c5]">
                    {t("panels:registers.focus")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <details className="group mt-3 rounded-md border border-[#223242] bg-[#0a121b]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[13px] font-medium text-[#9fb2c6] marker:hidden">
            <span>{t("panels:registers.others")}</span>
            <span className="font-mono text-[12px] text-[#5f7388] group-open:hidden">
              {t("panels:registers.showOthers")}
            </span>
            <span className="hidden font-mono text-[12px] text-[#5f7388] group-open:inline">
              {t("panels:registers.hideOthers")}
            </span>
          </summary>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[#1b2a3a] px-3 py-2">
            {OTHER.map((register) => {
              const key = register.toLowerCase();
              const value = snapshot?.registers[key] ?? null;
              const isChanged = changed.has(key);
              return (
                <div
                  key={register}
                  className="flex items-baseline justify-between gap-2 border-b border-[#14212e] py-1"
                  data-testid={`register-other-${key}`}
                >
                  <span className="shrink-0 font-mono text-[12px] text-[#7f93a8]">{register}</span>
                  <span
                    className={`min-w-0 truncate text-right font-mono text-[12.5px] tabular-nums ${
                      isChanged ? "text-emerald-200" : "text-[#b9c8d8]"
                    }`}
                    title={value ?? undefined}
                  >
                    {value ?? "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </details>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] leading-4 text-[#5f7388]">
            {t("panels:registers.footer")}
          </span>
          {!projection ? (
            <button
              type="button"
              onClick={() => setWorkbenchMode("developer")}
              className="ml-auto rounded-sm border border-[#2b3d51] bg-[#0c1520] px-2 py-1 text-[12.5px] text-[#8fa3b8] transition-colors hover:border-[#47627e] hover:text-[#d6e4f1]"
              title={session ? t("panels:workbench.modeDeveloperTitle") : undefined}
            >
              {t("panels:workbench.modeDeveloper")}
            </button>
          ) : null}
        </div>
        {!snapshot && !session ? (
          <p className="mt-2 text-[12.5px] leading-4 text-[#5f7388]">
            {t("panels:stackMap.noSnapshotHint")}
          </p>
        ) : null}
      </div>
    </section>
  );
});
