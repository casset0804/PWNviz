import { useTranslation } from "react-i18next";

import { normalizeAddress } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";
import type { DebuggerState, SnapshotPerf } from "../../types/debug";

const STATE_KEYS: Record<DebuggerState, string> = {
  IDLE: "state.idle",
  CREATED: "state.created",
  INITIALIZING: "state.initializing",
  READY: "state.ready",
  RUNNING: "state.running",
  STOPPED: "state.stopped",
  EXITED: "state.exited",
  ERROR: "state.error",
  TERMINATED: "state.terminated",
};

function statusTone(state: string): { dot: string; text: string } {
  switch (state) {
    case "INITIALIZING":
    case "CREATED":
    case "READY":
      return { dot: "bg-amber-400", text: "text-amber-200" };
    case "RUNNING":
      return { dot: "bg-emerald-400", text: "text-emerald-200" };
    case "STOPPED":
      return { dot: "bg-cyan-400", text: "text-cyan-200" };
    case "EXITED":
    case "TERMINATED":
      return { dot: "bg-slate-500", text: "text-slate-300" };
    case "ERROR":
      return { dot: "bg-rose-400", text: "text-rose-200" };
    default:
      return { dot: "bg-slate-600", text: "text-slate-400" };
  }
}

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-[#1d2938]" aria-hidden="true" />;
}

function perfValue(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" ? value.toFixed(digits) : "—";
}

export function StatusBar() {
  const { t } = useTranslation(["debugger", "common"]);
  const session = useDebugStore((state) => state.session);
  const debuggerState = useDebugStore((state) => state.debuggerState);
  const snapshot = useDebugStore((state) => state.snapshot);
  const streamStatus = useDebugStore((state) => state.streamStatus);
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const lastAction = useDebugStore((state) => state.lastAction);
  const busy = useDebugStore((state) => state.busy);

  const status = statusTone(debuggerState);
  const statusLabel = t(STATE_KEYS[debuggerState] ?? "state.idle");
  const rip = normalizeAddress(snapshot?.registers.rip ?? null);
  const breakpointText =
    breakpoints.length === 1
      ? t("state.breakpoint", {
          number: breakpoints[0].number ?? "?",
          address: breakpoints[0].address ?? "?",
        })
      : t("state.breakpoints", { count: breakpoints.length });
  const streamTone =
    streamStatus === "open"
      ? "bg-emerald-400"
      : streamStatus === "reconnecting"
        ? "bg-amber-400"
        : "bg-slate-600";

  const perf: SnapshotPerf | null | undefined = snapshot?.perf;
  const perfMode = perf
    ? perf.mode === "full"
      ? t("state.perfModeFull")
      : t("state.perfModeFast")
    : "";
  const perfTitle = perf
    ? t("state.perfTitle", {
        mode: perfMode,
        total: perfValue(perf.total_ms),
        commands: perf.mi_command_count,
        bytes: perf.payload_bytes,
        registers: perfValue(perf.registers_ms),
        frames: perfValue(perf.frames_ms),
        disassembly: perfValue(perf.disassembly_ms),
        memory: perfValue(perf.memory_ms),
        variables: perfValue(perf.variables_ms),
        diff: perfValue(perf.diff_ms),
        serialize: perfValue(perf.serialize_ms, 2),
        ws: perfValue(perf.ws_send_ms, 2),
      })
    : undefined;

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-2 overflow-hidden border-b border-[#1a2431] bg-[#090e15] px-3 font-mono text-[10px] text-[#718196]"
      data-testid="status-bar"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5" title={debuggerState}>
        <span className={`h-1.5 w-1.5 ${status.dot}`} aria-hidden="true" />
        <span
          className={`font-semibold uppercase tracking-[0.14em] ${status.text}`}
          data-testid="status-state"
          data-state={debuggerState}
        >
          {statusLabel}
        </span>
      </span>
      {busy ? <span className="shrink-0 text-amber-300/80">{t("state.working")}</span> : null}
      <Divider />
      <span className="hidden shrink-0 xl:inline">
        {t("state.action")} {lastAction ?? "—"}
      </span>
      <span className="hidden shrink-0 xl:inline">
        {t("state.stop")} {snapshot?.stop_reason ?? session?.stop_reason ?? "—"}
      </span>
      <span className="shrink-0">
        <span className="text-[#4f6074]">{t("state.rip")} </span>
        <span className="text-[#a9d8ee]">{rip ?? "—"}</span>
      </span>
      <Divider />
      <span className="shrink-0" data-testid="snapshot-id">
        <span className="text-[#4f6074]">{t("state.snap")} </span>#
        {snapshot?.snapshot_id ?? "—"}
      </span>
      {perf ? (
        <span
          className="shrink-0 text-[#7f93a8]"
          data-testid="perf-summary"
          data-perf-ms={perf.total_ms}
          data-mi-count={perf.mi_command_count}
          data-mode={perf.mode}
          title={perfTitle}
        >
          {t("state.perfSummary", {
            total: perfValue(perf.total_ms),
            commands: perf.mi_command_count,
          })}
        </span>
      ) : null}
      <span className="min-w-0 truncate" data-testid="breakpoint-count">
        {breakpointText}
      </span>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5" data-testid="stream-status">
        <span className={`h-1.5 w-1.5 ${streamTone}`} aria-hidden="true" />
        <span className="text-[#4f6074]">{t("state.stream")}</span>
        <span className="text-[#9eb0c3]">{streamStatus}</span>
      </span>
      {session ? (
        <span
          className="hidden shrink-0 text-[#4f6074] 2xl:inline"
          title={`${session.session_id} · ${t("state.gdb")} ${session.gdb_pid ?? "—"} / ${t(
            "state.inferior",
          )} ${session.inferior_pid ?? "—"}`}
        >
          {t("state.gdb")} {session.gdb_pid ?? "—"} / {t("state.inferior")}{" "}
          {session.inferior_pid ?? "—"}
        </span>
      ) : null}
      <span className="sr-only" data-testid="debug-state" data-state={debuggerState}>
        {t("state.debugState", { state: debuggerState.toLowerCase() })}
        {session?.stop_reason
          ? t("state.stopSuffix", { reason: session.stop_reason })
          : ""}
      </span>
    </div>
  );
}
