import { useTranslation } from "react-i18next";

import type { SampleInfo } from "../../types/api";
import { useDebugStore } from "../../stores/debugStore";
import { LanguageSwitch } from "../common/LanguageSwitch";

type ConnectionState = "checking" | "online" | "offline";

interface ToolbarProps {
  samples: SampleInfo[];
  connection: ConnectionState;
  ready: boolean;
}

function connectionColor(connection: ConnectionState): string {
  if (connection === "online") return "bg-emerald-400";
  if (connection === "checking") return "bg-sky-400";
  return "bg-rose-400";
}

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled: boolean;
  testId: string;
  emphasis?: boolean;
  title?: string;
}

function ActionButton({
  label,
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
      className={`h-6 border px-2 font-mono text-[10px] transition-colors ${
        emphasis
          ? "border-cyan-700/60 bg-cyan-500/[0.06] text-cyan-200 hover:border-cyan-500/80 hover:bg-cyan-500/[0.1]"
          : "border-[#253346] bg-[#0e151f] text-[#b6c4d4] hover:border-[#405572] hover:bg-[#131d29] hover:text-[#edf4fb]"
      } disabled:cursor-not-allowed disabled:border-[#192331] disabled:bg-[#0b1017] disabled:text-[#455365]`}
    >
      {label}
    </button>
  );
}

function ToolbarSeparator() {
  return <span className="mx-0.5 h-5 w-px bg-[#1d2938]" aria-hidden="true" />;
}

function LayoutToggle({
  active,
  label,
  title,
  testId,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      title={title}
      className={`h-6 border px-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors ${
        active
          ? "border-[#34465c] bg-[#131d29] text-[#a9b9cb]"
          : "border-[#1d2938] bg-[#0b1017] text-[#4f6074] hover:text-[#8fa2b7]"
      }`}
    >
      {label}
    </button>
  );
}

export function Toolbar({ samples, connection, ready }: ToolbarProps) {
  const { t } = useTranslation(["toolbar", "common"]);
  const selectedSampleId = useDebugStore((state) => state.selectedSampleId);
  const setSelectedSampleId = useDebugStore((state) => state.setSelectedSampleId);
  const session = useDebugStore((state) => state.session);
  const debuggerState = useDebugStore((state) => state.debuggerState);
  const busy = useDebugStore((state) => state.busy);
  const animationsEnabled = useDebugStore((state) => state.animationsEnabled);
  const leftPanelCollapsed = useDebugStore((state) => state.leftPanelCollapsed);
  const rightPanelCollapsed = useDebugStore((state) => state.rightPanelCollapsed);
  const toggleAnimations = useDebugStore((state) => state.toggleAnimations);
  const toggleLeftPanel = useDebugStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useDebugStore((state) => state.toggleRightPanel);
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

  const connectionLabel =
    connection === "online"
      ? t("toolbar:connectionOnline")
      : connection === "checking"
        ? t("toolbar:connectionChecking")
        : t("toolbar:connectionOffline");

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-[#1a2431] bg-[#090e15] px-3"
      data-testid="toolbar"
    >
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-[22px] w-[22px] place-items-center border border-emerald-500/35 bg-emerald-500/[0.08] font-mono text-[11px] font-bold text-emerald-300"
        >
          P
        </span>
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-[0.08em] text-[#dbe6f2]">
            {t("common:app.name")}
          </div>
          <div className="mt-1 hidden text-[8px] uppercase tracking-[0.22em] text-[#55657a] xl:block">
            {t("common:app.subtitle")}
          </div>
        </div>
      </div>

      <div className="mx-1 h-6 w-px shrink-0 bg-[#1d2938]" aria-hidden="true" />

      <label className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#5d6e82]">
        <span>{t("toolbar:target")}</span>
        <select
          value={selectedSampleId ?? ""}
          onChange={(event) => setSelectedSampleId(event.target.value)}
          disabled={Boolean(session) || samples.length === 0}
          aria-label={t("toolbar:target")}
          data-testid="sample-select"
          className="h-6 w-[9.5rem] border border-[#253346] bg-[#0d141d] px-1.5 font-mono text-[10px] normal-case tracking-normal text-[#d0dbe7] disabled:opacity-50"
        >
          {samples.length === 0 ? (
            <option value="">{t("toolbar:noSamples")}</option>
          ) : null}
          {samples.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.id}
              {sample.binary_exists ? "" : t("toolbar:notBuilt")}
            </option>
          ))}
        </select>
      </label>

      <div className="mx-1 h-6 w-px shrink-0 bg-[#1d2938]" aria-hidden="true" />

      <div className="flex shrink-0 items-center gap-1">
        <ActionButton
          label={t("toolbar:run")}
          testId="run-session"
          emphasis
          disabled={session ? !canLaunchExisting : !canStart}
          onClick={() => {
            void (session ? launchExisting() : startSession());
          }}
          title={
            session ? t("toolbar:runExistingTitle") : t("toolbar:runTitle")
          }
        />
        <ActionButton
          label={t("toolbar:continue")}
          testId="continue"
          disabled={!canContinue}
          onClick={() => void continueExecution()}
          title={t("toolbar:continueTitle")}
        />
        <ActionButton
          label={t("toolbar:pause")}
          testId="pause"
          disabled={!canPause}
          onClick={() => void pause()}
          title={t("toolbar:pauseTitle")}
        />
        <ToolbarSeparator />
        <ActionButton
          label={t("toolbar:stepInstruction")}
          testId="step-instruction"
          emphasis
          disabled={!canStep}
          onClick={() => void stepInstruction()}
          title={t("toolbar:stepInstructionTitle")}
        />
        <ActionButton
          label={t("toolbar:nextInstruction")}
          testId="next-instruction"
          disabled={!canStep}
          onClick={() => void nextInstruction()}
          title={t("toolbar:nextInstructionTitle")}
        />
        <ToolbarSeparator />
        <ActionButton
          label={t("toolbar:stepInto")}
          testId="step-into"
          disabled={!canStep}
          onClick={() => void stepSource()}
          title={t("toolbar:stepIntoTitle")}
        />
        <ActionButton
          label={t("toolbar:stepOver")}
          testId="step-over"
          disabled={!canStep}
          onClick={() => void nextSource()}
          title={t("toolbar:stepOverTitle")}
        />
        <ToolbarSeparator />
        <ActionButton
          label={t("toolbar:finish")}
          testId="finish"
          disabled={!canStep}
          onClick={() => void finish()}
          title={t("toolbar:finishTitle")}
        />
        <ToolbarSeparator />
        <ActionButton
          label={t("toolbar:restart")}
          testId="restart"
          disabled={!session || busy}
          onClick={() => void restartSession()}
          title={t("toolbar:restartTitle")}
        />
        <ActionButton
          label={t("toolbar:terminate")}
          testId="terminate"
          disabled={!session || busy}
          onClick={() => void terminate()}
          title={t("toolbar:terminateTitle")}
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <LanguageSwitch />
        <span
          className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#5d6e82]"
          title={connectionLabel}
        >
          <span className={`h-1.5 w-1.5 ${connectionColor(connection)}`} aria-hidden="true" />
          <span className="hidden 2xl:inline">{connectionLabel}</span>
        </span>
        <span className="mx-1 hidden h-6 w-px bg-[#1d2938] 2xl:block" aria-hidden="true" />
        <LayoutToggle
          active={!leftPanelCollapsed}
          label={t("toolbar:disasmLabel")}
          testId="toggle-disasm"
          title={
            leftPanelCollapsed
              ? t("toolbar:showDisasm")
              : t("toolbar:hideDisasm")
          }
          onClick={toggleLeftPanel}
        />
        <LayoutToggle
          active={!rightPanelCollapsed}
          label={t("toolbar:regsLabel")}
          testId="toggle-registers"
          title={
            rightPanelCollapsed
              ? t("toolbar:showRegs")
              : t("toolbar:hideRegs")
          }
          onClick={toggleRightPanel}
        />
        <label
          className="flex h-6 items-center gap-1.5 border border-[#253346] bg-[#0b1017] px-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#6b7c90]"
          title={t("toolbar:animationsTitle")}
        >
          <input
            type="checkbox"
            checked={animationsEnabled}
            onChange={toggleAnimations}
            className="h-3 w-3 accent-emerald-500"
            data-testid="animation-toggle"
            aria-label={t("toolbar:animations")}
          />
          {t("toolbar:animations")}
        </label>
      </div>
    </header>
  );
}
