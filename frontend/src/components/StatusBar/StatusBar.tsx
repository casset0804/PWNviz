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

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#1e2635] bg-[#0a0e14] px-4 py-1.5 font-mono text-[10px] text-slate-500"
      data-testid="status-bar"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
        <span className={`font-semibold uppercase tracking-[0.14em] ${status.text}`} data-testid="status-state">
          {status.label}
        </span>
      </span>
      {busy ? <span className="text-amber-300/80">working…</span> : null}
      <span>action: {lastAction ?? "—"}</span>
      <span>stop: {snapshot?.stop_reason ?? session?.stop_reason ?? "—"}</span>
      <span>rip: {rip ?? "—"}</span>
      <span>snapshot: {snapshot ? `#${snapshot.snapshot_id}` : "—"}</span>
      <span data-testid="breakpoint-count">{breakpointText}</span>
      <span className="ml-auto" data-testid="stream-status">
        stream: {streamStatus}
        {session ? ` · gdb ${session.gdb_pid ?? "—"} / inferior ${session.inferior_pid ?? "—"}` : ""}
      </span>
    </div>
  );
}
