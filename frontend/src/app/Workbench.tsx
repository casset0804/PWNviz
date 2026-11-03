import { useEffect } from "react";
import { BottomDock } from "../components/BottomDock/BottomDock";
import { DisassemblyView } from "../components/DisassemblyView/DisassemblyView";
import { RegisterPanel } from "../components/RegisterPanel/RegisterPanel";
import { StackMemoryView } from "../components/StackMemoryView/StackMemoryView";
import { Toolbar } from "../components/Toolbar/Toolbar";
import { useCapabilities } from "../hooks/useCapabilities";
import { useSamples } from "../hooks/useSamples";
import { useSessionStore } from "../stores/sessionStore";

export function Workbench() {
  const { data, error, loading, verifying, refresh } = useCapabilities();
  const { samples } = useSamples();
  const selectedSampleId = useSessionStore((state) => state.selectedSampleId);
  const setSelectedSampleId = useSessionStore((state) => state.setSelectedSampleId);
  const bottomTab = useSessionStore((state) => state.bottomTab);
  const setBottomTab = useSessionStore((state) => state.setBottomTab);

  useEffect(() => {
    if (!selectedSampleId && samples.length > 0) {
      setSelectedSampleId(samples[0].id);
    }
  }, [selectedSampleId, samples, setSelectedSampleId]);

  const connection = loading && !data ? "checking" : error ? "offline" : "online";

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#080a0f] text-slate-300">
      <Toolbar
        samples={samples}
        selectedSampleId={selectedSampleId}
        onSelectSample={setSelectedSampleId}
        connection={connection}
        ready={data?.ready ?? false}
      />

      <main className="grid min-h-0 flex-1 gap-px overflow-auto bg-[#1a2230] lg:grid-cols-[minmax(280px,1.05fr)_minmax(500px,2.2fr)_minmax(260px,0.95fr)] lg:overflow-hidden">
        <DisassemblyView />
        <StackMemoryView />
        <RegisterPanel />
      </main>

      <BottomDock
        capabilities={data}
        samples={samples}
        error={error}
        loading={loading}
        verifying={verifying}
        bottomTab={bottomTab}
        onTabChange={setBottomTab}
        onRefresh={() => refresh()}
        onVerifyPwndbg={() => refresh({ verifyPwndbg: true })}
      />

      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1e2635] bg-[#0b0f16] px-4 py-1.5 font-mono text-[10px] text-slate-600">
        <span>PWNviz v0.1.0 · phase 1 backend ready · UI not wired</span>
        <span className="text-slate-700">|</span>
        <span>
          gdb: {data?.gdb.version ?? "unknown"} · mi3:{" "}
          {data?.gdb.supports_mi3 ? "yes" : "no"} · arch:{" "}
          {data?.platform.architecture ?? "unknown"}
        </span>
        <span className="text-slate-700">|</span>
        <span>pwndbg: {data?.pwndbg.status ?? "unknown"}</span>
        <span className="ml-auto text-amber-400/70">
          no live debug session — debug panels intentionally empty
        </span>
      </footer>
    </div>
  );
}
