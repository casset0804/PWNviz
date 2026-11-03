import { StatusBadge } from "../common/StatusBadge";
import type { SampleInfo } from "../../types/api";

type ConnectionState = "checking" | "online" | "offline";

interface ToolbarProps {
  samples: SampleInfo[];
  selectedSampleId: string | null;
  onSelectSample: (sampleId: string) => void;
  connection: ConnectionState;
  ready: boolean;
}

const ACTIONS: Array<{ label: string; shortcut: string; emphasis?: boolean }> = [
  { label: "Run", shortcut: "r" },
  { label: "Continue", shortcut: "c" },
  { label: "Pause", shortcut: "p" },
  { label: "StepI", shortcut: "s", emphasis: true },
  { label: "NextI", shortcut: "n", emphasis: true },
  { label: "Finish", shortcut: "f" },
];

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  checking: "probing host",
  online: "backend online",
  offline: "backend offline",
};

export function Toolbar({
  samples,
  selectedSampleId,
  onSelectSample,
  connection,
  ready,
}: ToolbarProps) {
  const connectionTone =
    connection === "online" ? "ok" : connection === "checking" ? "info" : "error";

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#1e2635] bg-[#0b0f16] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded bg-emerald-500/15 font-mono text-xs font-bold text-emerald-400 ring-1 ring-emerald-500/30"
        >
          P
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide text-slate-100">
            PWNviz
          </div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-600">
            memory debug studio
          </div>
        </div>
      </div>

      <div className="mx-1 h-7 w-px bg-[#1e2635]" aria-hidden="true" />

      <label className="flex items-center gap-2 text-[11px] text-slate-500">
        <span className="uppercase tracking-[0.12em]">Target</span>
        <select
          value={selectedSampleId ?? ""}
          onChange={(event) => onSelectSample(event.target.value)}
          disabled={samples.length === 0}
          className="min-w-[11rem] rounded border border-[#263044] bg-[#111722] px-2 py-1 font-mono text-xs text-slate-200 disabled:opacity-50"
        >
          {samples.length === 0 ? <option value="">no samples discovered</option> : null}
          {samples.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.id}
              {sample.binary_exists ? "" : " (not built)"}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <StatusBadge tone={connectionTone}>{CONNECTION_LABEL[connection]}</StatusBadge>
        <StatusBadge tone={ready ? "ok" : "warn"}>
          {ready ? "debug-capable" : "not debug-capable"}
        </StatusBadge>
        <StatusBadge tone="idle">no live session</StatusBadge>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled
            title={`${action.label}: wires to a real GDB/MI3 command in Phase 1`}
            aria-disabled="true"
            className={`rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
              action.emphasis
                ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-500/60"
                : "border-[#263044] bg-[#111722] text-slate-500"
            } cursor-not-allowed`}
          >
            {action.label}
            <span className="ml-1 text-[9px] text-slate-600">{action.shortcut}</span>
          </button>
        ))}
      </div>
    </header>
  );
}
