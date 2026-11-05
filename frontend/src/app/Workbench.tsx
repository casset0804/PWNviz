import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { DeveloperWorkbench } from "../components/Developer/DeveloperWorkbench";
import { CurrentInstruction } from "../components/Instruction/CurrentInstruction";
import { PresentationWorkbench } from "../components/Presentation/PresentationWorkbench";
import { StatusBar } from "../components/StatusBar/StatusBar";
import { ExecutionBar } from "../components/Toolbar/ExecutionBar";
import { HeaderBar } from "../components/Toolbar/HeaderBar";
import { useCapabilities } from "../hooks/useCapabilities";
import { useSamples } from "../hooks/useSamples";
import { useDebugStore } from "../stores/debugStore";

export function Workbench() {
  const { t } = useTranslation(["panels", "errors", "common"]);
  const { data, error: capabilityError, loading, verifying, refresh } = useCapabilities();
  const { samples } = useSamples();
  const selectedSampleId = useDebugStore((state) => state.selectedSampleId);
  const setSelectedSampleId = useDebugStore((state) => state.setSelectedSampleId);
  const session = useDebugStore((state) => state.session);
  const error = useDebugStore((state) => state.error);
  const dismissError = useDebugStore((state) => state.dismissError);
  const attachSession = useDebugStore((state) => state.attachSession);
  const mode = useDebugStore((state) => state.workbenchMode);
  const projection = useDebugStore((state) => state.projectionMode);
  const attachAttempted = useRef(false);

  useEffect(() => {
    if (!selectedSampleId && samples.length > 0) {
      const preferred =
        samples.find((sample) => sample.id === "stack-basic") ?? samples[0];
      setSelectedSampleId(preferred.id);
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
  const ready = data?.ready ?? false;

  return (
    <div
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#070a0f] text-[#c3cedb]"
      data-testid="workbench"
      data-mode={mode}
    >
      <HeaderBar samples={samples} connection={connection} ready={ready} />
      <ExecutionBar ready={ready} />
      {/* Projection mode hides the developer status strip (perf, session ids,
          stream state); the teaching surfaces stay. */}
      {mode === "presentation" && projection ? null : <StatusBar />}
      {mode === "presentation" ? <CurrentInstruction /> : null}

      {error ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-rose-500/25 bg-rose-500/[0.07] px-4 py-2">
          <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-rose-300">
            {t("errors:title")}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-rose-100/80" title={error}>
            {error}
          </span>
          <button
            type="button"
            onClick={dismissError}
            className="h-8 shrink-0 rounded-sm border border-rose-500/25 px-2.5 text-[12px] text-rose-300 transition-colors hover:border-rose-300/60"
          >
            {t("common:dismiss")}
          </button>
        </div>
      ) : null}

      {mode === "presentation" ? (
        <PresentationWorkbench />
      ) : (
        <DeveloperWorkbench
          capabilities={data}
          samples={samples}
          error={capabilityError}
          loading={loading}
          verifying={verifying}
          onRefresh={() => refresh()}
          onVerifyPwndbg={() => refresh({ verifyPwndbg: true })}
        />
      )}
    </div>
  );
}
