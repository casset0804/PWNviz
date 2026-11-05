import { useTranslation } from "react-i18next";

import { useDebugStore } from "../../stores/debugStore";

interface ExecutionBarProps {
  ready: boolean;
}

interface ActionButtonProps {
  label: string;
  glyph?: string;
  onClick: () => void;
  disabled: boolean;
  testId: string;
  title: string;
  variant?: "primary" | "normal" | "quiet" | "danger";
}

const VARIANTS: Record<NonNullable<ActionButtonProps["variant"]>, string> = {
  primary:
    "border-cyan-400/50 bg-cyan-500/[0.12] text-[#d9f4ff] hover:border-cyan-300/80 hover:bg-cyan-500/[0.18]",
  normal:
    "border-[#2b3d51] bg-[#0c1520] text-[#c6d5e5] hover:border-[#47627e] hover:bg-[#111e2b] hover:text-[#eef6ff]",
  quiet:
    "border-[#26384b] bg-[#0a121b] text-[#8fa3b8] hover:border-[#3c5168] hover:text-[#d2e0ed]",
  danger:
    "border-rose-500/30 bg-rose-500/[0.04] text-rose-200/90 hover:border-rose-400/60 hover:bg-rose-500/[0.09]",
};

function ActionButton({
  label,
  glyph,
  onClick,
  disabled,
  testId,
  title,
  variant = "normal",
}: ActionButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-[46px] shrink-0 items-center gap-2 rounded-md border px-3.5 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:border-[#1b2836] disabled:bg-[#0a1018] disabled:text-[#46586b] ${VARIANTS[variant]}`}
    >
      {glyph ? (
        <span aria-hidden="true" className="font-mono text-[13px] leading-none opacity-85">
          {glyph}
        </span>
      ) : null}
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-7 w-px shrink-0 bg-[#1c2a39]" aria-hidden="true" />;
}

/**
 * One execution surface shared by both modes. It talks only to the single
 * Zustand debug store, so presentation and developer mode can never diverge.
 */
export function ExecutionBar({ ready }: ExecutionBarProps) {
  const { t } = useTranslation(["toolbar", "common"]);
  const selectedSampleId = useDebugStore((state) => state.selectedSampleId);
  const session = useDebugStore((state) => state.session);
  const debuggerState = useDebugStore((state) => state.debuggerState);
  const busy = useDebugStore((state) => state.busy);
  const animationsEnabled = useDebugStore((state) => state.animationsEnabled);
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
  const stopped = debuggerState === "STOPPED" && Boolean(session) && !busy;
  const running = debuggerState === "RUNNING" && Boolean(session) && !busy;

  return (
    <div
      className="flex min-h-[62px] shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[#182636] bg-[#080f17] px-4 py-2"
      data-testid="execution-toolbar"
      role="toolbar"
      aria-label={t("toolbar:execution")}
    >
      <ActionButton
        label={t("toolbar:run")}
        glyph="▶"
        variant="primary"
        testId="run-session"
        disabled={session ? !canLaunchExisting : !canStart}
        onClick={() => void (session ? launchExisting() : startSession())}
        title={session ? t("toolbar:runExistingTitle") : t("toolbar:runTitle")}
      />
      <ActionButton
        label={t("toolbar:continue")}
        glyph="⏵"
        testId="continue"
        disabled={!stopped}
        onClick={() => void continueExecution()}
        title={t("toolbar:continueTitle")}
      />
      <ActionButton
        label={t("toolbar:pause")}
        glyph="⏸"
        variant="quiet"
        testId="pause"
        disabled={!running}
        onClick={() => void pause()}
        title={t("toolbar:pauseTitle")}
      />
      <Divider />
      <ActionButton
        label={t("toolbar:stepInstruction")}
        glyph="⤓"
        variant="primary"
        testId="step-instruction"
        disabled={!stopped}
        onClick={() => void stepInstruction()}
        title={t("toolbar:stepInstructionTitle")}
      />
      <ActionButton
        label={t("toolbar:nextInstruction")}
        glyph="↷"
        testId="next-instruction"
        disabled={!stopped}
        onClick={() => void nextInstruction()}
        title={t("toolbar:nextInstructionTitle")}
      />
      <ActionButton
        label={t("toolbar:stepInto")}
        glyph="↘"
        testId="step-into"
        disabled={!stopped}
        onClick={() => void stepSource()}
        title={t("toolbar:stepIntoTitle")}
      />
      <ActionButton
        label={t("toolbar:stepOver")}
        glyph="⤼"
        testId="step-over"
        disabled={!stopped}
        onClick={() => void nextSource()}
        title={t("toolbar:stepOverTitle")}
      />
      <ActionButton
        label={t("toolbar:finish")}
        glyph="⇥"
        testId="finish"
        disabled={!stopped}
        onClick={() => void finish()}
        title={t("toolbar:finishTitle")}
      />
      <Divider />
      <ActionButton
        label={t("toolbar:restart")}
        glyph="↺"
        variant="quiet"
        testId="restart"
        disabled={!session || busy}
        onClick={() => void restartSession()}
        title={t("toolbar:restartTitle")}
      />
      <ActionButton
        label={t("toolbar:terminate")}
        glyph="■"
        variant="danger"
        testId="terminate"
        disabled={!session || busy}
        onClick={() => void terminate()}
        title={t("toolbar:terminateTitle")}
      />

      <label
        className="ml-auto flex h-[46px] shrink-0 cursor-pointer items-center gap-2 rounded-md border border-[#2b3d51] bg-[#0c1520] px-3 text-[13px] text-[#a4b7ca] transition-colors hover:border-[#47627e]"
        title={t("toolbar:animationsTitle")}
      >
        <input
          type="checkbox"
          checked={animationsEnabled}
          onChange={toggleAnimations}
          className="h-4 w-4 accent-emerald-500"
          data-testid="animation-toggle"
          aria-label={t("toolbar:animations")}
        />
        {t("toolbar:animations")}
      </label>
    </div>
  );
}
