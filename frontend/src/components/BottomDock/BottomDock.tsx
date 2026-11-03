import type { Capabilities, SampleInfo } from "../../types/api";
import { useDebugStore, type BottomTab } from "../../stores/debugStore";
import { DebugLogPanel } from "../DebugLogPanel/DebugLogPanel";
import { DiffPanel } from "../DiffPanel/DiffPanel";
import { EnvironmentPanel } from "../EnvironmentPanel/EnvironmentPanel";
import { ExplanationPanel } from "../ExplanationPanel/ExplanationPanel";
import { MemoryInspector } from "../MemoryInspector/MemoryInspector";

interface BottomDockProps {
  capabilities: Capabilities | null;
  samples: SampleInfo[];
  error: string | null;
  loading: boolean;
  verifying: boolean;
  onRefresh: () => void;
  onVerifyPwndbg: () => void;
}

const TABS: Array<{ id: BottomTab; label: string; meta: string }> = [
  { id: "memory", label: "Memory Inspector", meta: "selected byte" },
  { id: "diff", label: "Diff", meta: "byte + register" },
  { id: "explanation", label: "Explanation", meta: "measured effects" },
  { id: "log", label: "Debug Log", meta: "session events" },
  { id: "environment", label: "Environment", meta: "host probes" },
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
  const bottomTab = useDebugStore((state) => state.bottomTab);
  const setBottomTab = useDebugStore((state) => state.setBottomTab);
  const snapshot = useDebugStore((state) => state.snapshot);
  const log = useDebugStore((state) => state.log);

  return (
    <section
      className="flex h-[19rem] shrink-0 flex-col border-t border-[#1e2635] bg-[#0d1117]"
      aria-label="Inspector dock"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#1e2635] px-2 py-1.5">
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
              onClick={() => setBottomTab(tab.id)}
              aria-pressed={active}
              className={`flex items-baseline gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] transition-colors ${
                active
                  ? "bg-[#182131] text-slate-100"
                  : "text-slate-500 hover:bg-[#131a26] hover:text-slate-300"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[9px] uppercase tracking-wide ${
                  active ? "text-emerald-400/80" : "text-slate-700"
                }`}
              >
                {tab.meta}
              </span>
              {badge !== null ? (
                <span className="rounded bg-emerald-500/10 px-1 text-[9px] text-emerald-300">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {bottomTab === "memory" ? <MemoryInspector /> : null}
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
    </section>
  );
}
