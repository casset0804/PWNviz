import { useTranslation } from "react-i18next";

import type { Capabilities, SampleInfo } from "../../types/api";
import { useDebugStore, type BottomTab } from "../../stores/debugStore";
import { DebugLogPanel } from "../DebugLogPanel/DebugLogPanel";
import { DiffPanel } from "../DiffPanel/DiffPanel";
import { EnvironmentPanel } from "../EnvironmentPanel/EnvironmentPanel";
import { ExplanationPanel } from "../ExplanationPanel/ExplanationPanel";
import { MemoryInspector } from "../MemoryInspector/MemoryInspector";
import { VariablesPanel } from "../VariablesPanel/VariablesPanel";

interface BottomDockProps {
  capabilities: Capabilities | null;
  samples: SampleInfo[];
  error: string | null;
  loading: boolean;
  verifying: boolean;
  onRefresh: () => void;
  onVerifyPwndbg: () => void;
}

const TABS: Array<{ id: BottomTab; labelKey: string; metaKey: string }> = [
  { id: "memory", labelKey: "panels:dock.memory", metaKey: "panels:dock.memoryMeta" },
  { id: "variables", labelKey: "panels:dock.variables", metaKey: "panels:dock.variablesMeta" },
  { id: "diff", labelKey: "panels:dock.diff", metaKey: "panels:dock.diffMeta" },
  {
    id: "explanation",
    labelKey: "panels:dock.explanation",
    metaKey: "panels:dock.explanationMeta",
  },
  { id: "log", labelKey: "panels:dock.log", metaKey: "panels:dock.logMeta" },
  {
    id: "environment",
    labelKey: "panels:dock.environment",
    metaKey: "panels:dock.environmentMeta",
  },
];

export function BottomDock({
  capabilities,
  samples,
  error,
  loading,
  verifying,
  onRefresh,
  onVerifyPwndbg,
}: BottomDockProps) {
  const { t } = useTranslation(["panels", "common"]);
  const bottomTab = useDebugStore((state) => state.bottomTab);
  const setBottomTab = useDebugStore((state) => state.setBottomTab);
  const bottomDockCollapsed = useDebugStore((state) => state.bottomDockCollapsed);
  const toggleBottomDock = useDebugStore((state) => state.toggleBottomDock);
  const snapshot = useDebugStore((state) => state.snapshot);
  const log = useDebugStore((state) => state.log);

  return (
    <section
      className={`flex shrink-0 flex-col border-t border-[#1a2431] bg-[#0b1017] ${
        bottomDockCollapsed ? "h-8" : "h-[clamp(9.5rem,21vh,15rem)]"
      }`}
      aria-label={t("panels:dock.aria")}
      data-testid="bottom-dock"
    >
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-[#1a2431] bg-[#090e15] px-2">
        {TABS.map((tab) => {
          const active = tab.id === bottomTab;
          const badge =
            tab.id === "diff" && snapshot?.diff.changed_bytes.length
              ? snapshot.diff.changed_bytes.length
              : tab.id === "log" && log.length
                ? log.length
                : null;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`tab-${tab.id}`}
              title={t(tab.metaKey)}
              onClick={() => {
                setBottomTab(tab.id);
                if (bottomDockCollapsed) toggleBottomDock();
              }}
              aria-pressed={active}
              className={`relative flex h-8 items-center gap-1.5 border-b px-2 font-mono text-[10px] transition-colors ${
                active
                  ? "border-cyan-400/70 bg-[#0d151f] text-[#d5e2ef]"
                  : "border-transparent text-[#68798d] hover:bg-[#0d141d] hover:text-[#b6c5d6]"
              }`}
            >
              <span>{t(tab.labelKey)}</span>
              {badge !== null ? (
                <span className="min-w-3 border border-emerald-500/20 bg-emerald-500/[0.08] px-1 text-[8px] leading-3 text-emerald-300">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleBottomDock}
          data-testid="dock-toggle"
          aria-label={
            bottomDockCollapsed
              ? t("panels:dock.expandDock")
              : t("panels:dock.collapseDock")
          }
          title={
            bottomDockCollapsed
              ? t("panels:dock.expandDock")
              : t("panels:dock.collapseDock")
          }
          className="ml-auto grid h-6 w-6 place-items-center border border-[#202c3b] bg-[#0d141d] font-mono text-[11px] leading-none text-[#718297] hover:border-[#3a4b60] hover:text-[#c6d3e2]"
        >
          {bottomDockCollapsed ? "▲" : "▼"}
        </button>
      </div>

      {!bottomDockCollapsed ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {bottomTab === "memory" ? <MemoryInspector /> : null}
          {bottomTab === "variables" ? <VariablesPanel /> : null}
          {bottomTab === "diff" ? <DiffPanel /> : null}
          {bottomTab === "explanation" ? <ExplanationPanel /> : null}
          {bottomTab === "log" ? <DebugLogPanel /> : null}
          {bottomTab === "environment" ? (
            <EnvironmentPanel
              capabilities={capabilities}
              samples={samples}
              error={error}
              loading={loading}
              verifying={verifying}
              onRefresh={onRefresh}
              onVerifyPwndbg={onVerifyPwndbg}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
