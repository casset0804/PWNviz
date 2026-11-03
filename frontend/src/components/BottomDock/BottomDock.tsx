import { ExplanationPanel } from "../ExplanationPanel/ExplanationPanel";
import { MemoryInspector } from "../MemoryInspector/MemoryInspector";
import { EnvironmentPanel } from "../EnvironmentPanel/EnvironmentPanel";
import { StatusBadge } from "../common/StatusBadge";
import type { BottomTab } from "../../stores/sessionStore";
import type { Capabilities, SampleInfo } from "../../types/api";

interface BottomDockProps {
  capabilities: Capabilities | null;
  samples: SampleInfo[];
  error: string | null;
  loading: boolean;
  verifying: boolean;
  bottomTab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  onRefresh: () => void;
  onVerifyPwndbg: () => void;
}

const TABS: Array<{ id: BottomTab; label: string; meta: string }> = [
  { id: "environment", label: "Environment", meta: "live host probes" },
  { id: "memory", label: "Memory Inspector", meta: "phase 2" },
  { id: "diff", label: "Diff", meta: "phase 2" },
  { id: "explanation", label: "Explanation", meta: "phase 4" },
  { id: "log", label: "Debug Log", meta: "phase 1" },
];

function DiffPlaceholder() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <StatusBadge tone="idle">phase 2</StatusBadge>
        <span className="text-[11px] text-slate-500">
          Byte-level before/after diff will list every changed address.
        </span>
      </div>
      <p className="max-w-3xl text-[11px] leading-5 text-slate-500">
        After each real single step, the backend compares the new stack window
        against the previous snapshot and emits changed addresses with before/after
        bytes. The canvas highlights those bytes and this tab shows the same facts
        as text so colour is never the only signal.
      </p>
    </div>
  );
}

function DebugLogPlaceholder() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <StatusBadge tone="idle">phase 1</StatusBadge>
        <span className="text-[11px] text-slate-500">
          Raw GDB/MI parser output will stream here for transparency.
        </span>
      </div>
      <pre className="rounded border border-[#1e2635] bg-[#0a0e14] p-3 font-mono text-[10px] leading-5 text-slate-600">
        {"> waiting for a debug session\n> no GDB process has been spawned yet"}
      </pre>
    </div>
  );
}

export function BottomDock({
  capabilities,
  samples,
  error,
  loading,
  verifying,
  bottomTab,
  onTabChange,
  onRefresh,
  onVerifyPwndbg,
}: BottomDockProps) {
  return (
    <section
      className="flex h-[18rem] shrink-0 flex-col border-t border-[#1e2635] bg-[#0d1117]"
      aria-label="Inspector dock"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-[#1e2635] px-2 py-1.5">
        {TABS.map((tab) => {
          const active = tab.id === bottomTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
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
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
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
        {bottomTab === "memory" ? <MemoryInspector /> : null}
        {bottomTab === "diff" ? <DiffPlaceholder /> : null}
        {bottomTab === "explanation" ? <ExplanationPanel /> : null}
        {bottomTab === "log" ? <DebugLogPlaceholder /> : null}
      </div>
    </section>
  );
}
