import type { SampleInfo } from "../../types/api";
import { useDebugStore } from "../../stores/debugStore";
import { StatusBadge, type Tone } from "../common/StatusBadge";

type ConnectionState = "checking" | "online" | "offline";

interface ToolbarProps {
  samples: SampleInfo[];
  connection: ConnectionState;
  ready: boolean;
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  checking: "probing host",
  online: "backend online",
  offline: "backend offline",
};

function stateTone(state: string): Tone {
  if (state === "STOPPED" || state === "READY") return "ok";
  if (state === "RUNNING" || state === "INITIALIZING") return "info";
  if (state === "ERROR") return "error";
  if (state === "EXITED" || state === "TERMINATED") return "warn";
  return "idle";
}

interface ActionButtonProps {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled: boolean;
  testId: string;
  emphasis?: boolean;
  title?: string;
}

function ActionButton({
  label,
  shortcut,
  onClick,
  disabled,
  testId,
  emphasis,
  title,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        emphasis
          ? "border-emerald-700/60 bg-emerald-900/20 text-emerald-200 hover:border-emerald-400"
          : "border-[#263044] bg-[#111722] text-slate-300 hover:border-slate-500 hover:text-white"
      } disabled:cursor-not-allowed disabled:border-[#1e2635] disabled:bg-[#0b0f16] disabled:text-slate-600`}
    >
      {label}
      {shortcut ? <span className="ml-1 text-[9px] text-slate-600">{shortcut}</span> : null}
    </button>
  );
}

export function Toolbar({ samples, connection, ready }: ToolbarProps) {
  const selectedSampleId = useDebugStore((state) => state.selectedSampleId);
  const setSelectedSampleId = useDebugStore((state) => state.setSelectedSampleId);
  const session = useDebugStore((state) => state.session);
  const debuggerState = useDebugStore((state) => state.debuggerState);
  const busy = useDebugStore((state) => state.busy);
  const streamStatus = useDebugStore((state) => state.streamStatus);
  const animationsEnabled = useDebugStore((state) => state.animationsEnabled);
  const snapshot = useDebugStore((state) => state.snapshot);
  const toggleAnimations = useDebugStore((state) => state.toggleAnimations);
  const startSession = useDebugStore((state) => state.startSession);
  const launchExisting = useDebugStore((state) => state.launchExisting);
  const continueExecution = useDebugStore((state) => state.continueExecution);
  const pause = useDebugStore((state) => state.pause);
  const stepInstruction = useDebugStore((state) => state.stepInstruction);
  const nextInstruction = useDebugStore((state) => state.nextInstruction);
  const stepSource = useDebugStore((state) => state.stepSource);
  const nextSource = useDebugStore((state) => state.nextSource);
  const finish = useDebugStore((state) => state.finish);
  const restartSession = useDebugStore((state) => state.restartSession);
  const terminate = useDebugStore((state) => state.terminate);

  const canStart = !session && !busy && Boolean(selectedSampleId) && ready;
  const canLaunchExisting =
    Boolean(session) && (session?.state === "CREATED" || session?.state === "READY") && !busy;
  const canContinue = debuggerState === "STOPPED" && Boolean(session) && !busy;
  const canPause = debuggerState === "RUNNING" && Boolean(session) && !busy;
  const canStep = debuggerState === "STOPPED" && Boolean(session) && !busy;
  const connectionTone =
    connection === "online" ? "ok" : connection === "checking" ? "info" : "error";
  const streamTone: Tone =
    streamStatus === "open" ? "ok" : streamStatus === "reconnecting" ? "warn" : "idle";

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
          <div className="text-sm font-semibold tracking-wide text-slate-100">PWNviz</div>
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
          onChange={(event) => setSelectedSampleId(event.target.value)}
          disabled={Boolean(session) || samples.length === 0}
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

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={connectionTone}>{CONNECTION_LABEL[connection]}</StatusBadge>
        <StatusBadge tone={stateTone(debuggerState)}>{debuggerState.toLowerCase()}</StatusBadge>
        <StatusBadge tone={streamTone}>
          {streamStatus === "open"
            ? "stream live"
            : streamStatus === "reconnecting"
              ? "stream reconnecting"
              : streamStatus === "connecting"
                ? "stream connecting"
                : "stream closed"}
        </StatusBadge>
        {session ? (
          <span className="font-mono text-[10px] text-slate-600" title={session.session_id}>
            {session.session_id.slice(0, 15)}…
          </span>
        ) : null}
        {snapshot ? (
          <span className="font-mono text-[10px] text-slate-500" data-testid="snapshot-id">
            snapshot #{snapshot.snapshot_id}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <ActionButton
          label="Run"
          shortcut="r"
          testId="run-session"
          emphasis
          disabled={session ? !canLaunchExisting : !canStart}
          onClick={() => {
            void (session ? launchExisting() : startSession());
          }}
          title={session ? "Launch the created session" : "Create a session and run to main"}
        />
        <ActionButton
          label="Continue"
          shortcut="c"
          testId="continue"
          disabled={!canContinue}
          onClick={() => void continueExecution()}
        />
        <ActionButton
          label="Pause"
          shortcut="p"
          testId="pause"
          disabled={!canPause}
          onClick={() => void pause()}
        />
        <ActionButton
          label="StepI"
          shortcut="s"
          testId="step-instruction"
          emphasis
          disabled={!canStep}
          onClick={() => void stepInstruction()}
          title="Step Instruction — execute one machine instruction"
        />
        <ActionButton
          label="NextI"
          shortcut="n"
          testId="next-instruction"
          disabled={!canStep}
          onClick={() => void nextInstruction()}
          title="Next Instruction — execute one instruction, stepping over calls"
        />
        <ActionButton
          label="Step Into"
          shortcut="i"
          testId="step-into"
          disabled={!canStep}
          onClick={() => void stepSource()}
          title="Step Into — source-level step into calls"
        />
        <ActionButton
          label="Step Over"
          shortcut="o"
          testId="step-over"
          disabled={!canStep}
          onClick={() => void nextSource()}
          title="Step Over — source-level step over calls"
        />
        <ActionButton
          label="Finish"
          shortcut="f"
          testId="finish"
          disabled={!canStep}
          onClick={() => void finish()}
        />
        <ActionButton
          label="Restart"
          testId="restart"
          disabled={!session || busy}
          onClick={() => void restartSession()}
          title="Delete this session and start a fresh run at main"
        />
        <ActionButton
          label="Terminate"
          testId="terminate"
          disabled={!session || busy}
          onClick={() => void terminate()}
        />
      </div>

      <label className="flex items-center gap-1.5 rounded border border-[#263044] bg-[#0b0f16] px-2 py-1 font-mono text-[10px] text-slate-400">
        <input
          type="checkbox"
          checked={animationsEnabled}
          onChange={toggleAnimations}
          className="h-3 w-3 accent-emerald-500"
          data-testid="animation-toggle"
        />
        diff animation
      </label>
    </header>
  );
}
