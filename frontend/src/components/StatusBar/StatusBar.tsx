import { normalizeAddress } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";

type StatusLabel = "Idle" | "Initializing" | "Running" | "Stopped" | "Exited" | "Error";

function statusFor(state: string): { label: StatusLabel; dot: string; text: string } {
  switch (state) {
    case "INITIALIZING":
    case "CREATED":
    case "READY":
      return { label: "Initializing", dot: "bg-amber-400", text: "text-amber-200" };
    case "RUNNING":
      return { label: "Running", dot: "bg-emerald-400", text: "text-emerald-200" };
    case "STOPPED":
      return { label: "Stopped", dot: "bg-cyan-400", text: "text-cyan-200" };
    case "EXITED":
    case "TERMINATED":
      return { label: "Exited", dot: "bg-slate-500", text: "text-slate-300" };
    case "ERROR":
      return { label: "Error", dot: "bg-rose-400", text: "text-rose-200" };
    default:
      return { label: "Idle", dot: "bg-slate-600", text: "text-slate-400" };
  }
}

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-[#1d2938]" aria-hidden="true" />;
}

export function StatusBar() {
  const session = useDebugStore((state) => state.session);
  const debuggerState = useDebugStore((state) => state.debuggerState);
  const snapshot = useDebugStore((state) => state.snapshot);
  const streamStatus = useDebugStore((state) => state.streamStatus);
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const lastAction = useDebugStore((state) => state.lastAction);
  const busy = useDebugStore((state) => state.busy);

  const status = statusFor(debuggerState);
  const rip = normalizeAddress(snapshot?.registers.rip ?? null);
  const breakpointText =
    breakpoints.length === 1
      ? `bp ${breakpoints[0].number ?? "?"} @ ${breakpoints[0].address ?? "?"}`
      : `${breakpoints.length} breakpoints`;
  const streamTone =
    streamStatus === "open"
      ? "bg-emerald-400"
      : streamStatus === "reconnecting"
        ? "bg-amber-400"
        : "bg-slate-600";

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
        >
          {status.label}
        </span>
      </span>
      {busy ? <span className="shrink-0 text-amber-300/80">working…</span> : null}
      <Divider />
      <span className="hidden shrink-0 xl:inline">action {lastAction ?? "—"}</span>
      <span className="hidden shrink-0 xl:inline">stop {snapshot?.stop_reason ?? session?.stop_reason ?? "—"}</span>
      <span className="shrink-0">
        <span className="text-[#4f6074]">rip </span>
        <span className="text-[#a9d8ee]">{rip ?? "—"}</span>
      </span>
      <Divider />
      <span className="shrink-0" data-testid="snapshot-id">
        <span className="text-[#4f6074]">snap </span>#{snapshot?.snapshot_id ?? "—"}
      </span>
      <span className="min-w-0 truncate" data-testid="breakpoint-count">
        {breakpointText}
      </span>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5" data-testid="stream-status">
        <span className={`h-1.5 w-1.5 ${streamTone}`} aria-hidden="true" />
        <span className="text-[#4f6074]">stream</span>
        <span className="text-[#9eb0c3]">{streamStatus}</span>
      </span>
      {session ? (
        <span
          className="hidden shrink-0 text-[#4f6074] 2xl:inline"
          title={`${session.session_id} · gdb ${session.gdb_pid ?? "—"} / inferior ${session.inferior_pid ?? "—"}`}
        >
          gdb {session.gdb_pid ?? "—"} / inf {session.inferior_pid ?? "—"}
        </span>
      ) : null}
      <span className="sr-only" data-testid="debug-state">
        state: {debuggerState.toLowerCase()}
        {session ? ` · stop: ${session.stop_reason ?? "—"}` : ""}
      </span>
    </div>
  );
}
