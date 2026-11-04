import { useEffect, useRef } from "react";

import { BottomDock } from "../components/BottomDock/BottomDock";
import { PanelRail } from "../components/common/PanelRail";
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
  const error = useDebugStore((state) => state.error);
  const dismissError = useDebugStore((state) => state.dismissError);
  const attachSession = useDebugStore((state) => state.attachSession);
  const leftPanelCollapsed = useDebugStore((state) => state.leftPanelCollapsed);
  const rightPanelCollapsed = useDebugStore((state) => state.rightPanelCollapsed);
  const toggleLeftPanel = useDebugStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useDebugStore((state) => state.toggleRightPanel);
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
    <div className="flex h-screen min-h-0 flex-col bg-[#070a0f] text-[#c3cedb]" data-testid="workbench">
      <Toolbar samples={samples} connection={connection} ready={data?.ready ?? false} />
      <StatusBar />

      {error ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-rose-500/25 bg-rose-500/[0.07] px-3 py-1.5">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-rose-300">
            debugger error
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-rose-100/70" title={error}>
            {error}
          </span>
          <button
            type="button"
            onClick={dismissError}
            className="border border-rose-500/25 px-1.5 py-0.5 font-mono text-[9px] text-rose-300 hover:border-rose-300/60"
          >
            dismiss
          </button>
        </div>
      ) : null}

      <main
        className={`debug-layout min-h-0 flex-1 ${
          leftPanelCollapsed ? "left-collapsed" : ""
        } ${rightPanelCollapsed ? "right-collapsed" : ""}`}
      >
        {leftPanelCollapsed ? (
          <PanelRail label="Disassembly" side="left" onExpand={toggleLeftPanel} />
        ) : (
          <DisassemblyView onCollapse={toggleLeftPanel} />
        )}
        <StackMemoryView />
        {rightPanelCollapsed ? (
          <PanelRail label="Registers" side="right" onExpand={toggleRightPanel} />
        ) : (
          <RegisterPanel onCollapse={toggleRightPanel} />
        )}
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
    </div>
  );
}
