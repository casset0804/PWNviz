import { useEffect, useRef } from "react";

import { BottomDock } from "../components/BottomDock/BottomDock";
import { DisassemblyView } from "../components/DisassemblyView/DisassemblyView";
import { RegisterPanel } from "../components/RegisterPanel/RegisterPanel";
import { StackMemoryView } from "../components/StackMemoryView/StackMemoryView";
import { StatusBar } from "../components/StatusBar/StatusBar";
import { Toolbar } from "../components/Toolbar/Toolbar";
import { useCapabilities } from "../hooks/useCapabilities";
import { useSamples } from "../hooks/useSamples";
import { useDebugStore } from "../stores/debugStore";

export function Workbench() {
  const { data, error: capabilityError, loading, verifying, refresh } = useCapabilities();
  const { samples } = useSamples();
  const selectedSampleId = useDebugStore((state) => state.selectedSampleId);
  const setSelectedSampleId = useDebugStore((state) => state.setSelectedSampleId);
  const session = useDebugStore((state) => state.session);
  const snapshot = useDebugStore((state) => state.snapshot);
  const debuggerState = useDebugStore((state) => state.debuggerState);
  const streamStatus = useDebugStore((state) => state.streamStatus);
  const error = useDebugStore((state) => state.error);
  const dismissError = useDebugStore((state) => state.dismissError);
  const attachSession = useDebugStore((state) => state.attachSession);
  const attachAttempted = useRef(false);

  useEffect(() => {
    if (!selectedSampleId && samples.length > 0) {
      setSelectedSampleId(samples[0].id);
    }
  }, [selectedSampleId, samples, setSelectedSampleId]);

  useEffect(() => {
    if (attachAttempted.current || session) return;
    attachAttempted.current = true;
    const requested = new URLSearchParams(window.location.search).get("sessionId");
    if (requested) {
      void attachSession(requested);
    }
  }, [attachSession, session]);

  const connection = loading && !data ? "checking" : capabilityError ? "offline" : "online";

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#080a0f] text-slate-300" data-testid="workbench">
      <Toolbar samples={samples} connection={connection} ready={data?.ready ?? false} />
      <StatusBar />

      {error ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-rose-500/30 bg-rose-500/10 px-4 py-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-rose-300">
            debugger error
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-rose-100/80" title={error}>
            {error}
          </span>
          <button
            type="button"
            onClick={dismissError}
            className="rounded border border-rose-500/30 px-1.5 py-0.5 font-mono text-[10px] text-rose-300 hover:border-rose-300"
          >
            dismiss
          </button>
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 gap-px overflow-auto bg-[#1a2230] lg:grid-cols-[minmax(280px,1fr)_minmax(540px,2.5fr)_minmax(270px,0.9fr)] lg:overflow-hidden">
        <DisassemblyView />
        <StackMemoryView />
        <RegisterPanel />
      </main>

      <BottomDock
        capabilities={data}
        samples={samples}
        error={capabilityError}
        loading={loading}
        verifying={verifying}
        onRefresh={() => refresh()}
        onVerifyPwndbg={() => refresh({ verifyPwndbg: true })}
      />

      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1e2635] bg-[#0b0f16] px-4 py-1.5 font-mono text-[10px] text-slate-600">
        <span>PWNviz v0.1.0 · real GDB/MI3</span>
        <span className="text-slate-700">|</span>
        <span data-testid="debug-state">
          state: {session ? debuggerState.toLowerCase() : "idle"}
          {session ? ` · stop: ${session.stop_reason ?? "—"}` : ""}
        </span>
        <span className="text-slate-700">|</span>
        <span>
          stream: {streamStatus} · gdb: {data?.gdb.version ?? "unknown"} · mi3:{" "}
          {data?.gdb.supports_mi3 ? "yes" : "no"}
        </span>
        <span className="text-slate-700">|</span>
        <span>
          snapshot: {snapshot ? `#${snapshot.snapshot_id}` : "none"} · pids:{" "}
          {session?.gdb_pid ?? "—"}/{session?.inferior_pid ?? "—"}
        </span>
        <span className="ml-auto text-slate-500">
          {session ? "values are live from GDB" : "no live debug session"}
        </span>
      </footer>
    </div>
  );
}
