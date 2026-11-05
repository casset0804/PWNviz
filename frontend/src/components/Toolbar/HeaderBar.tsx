import { useTranslation } from "react-i18next";

import { useDebugStore, type WorkbenchMode } from "../../stores/debugStore";
import type { SampleInfo } from "../../types/api";
import { LanguageSwitch } from "../common/LanguageSwitch";

type ConnectionState = "checking" | "online" | "offline";

interface HeaderBarProps {
  samples: SampleInfo[];
  connection: ConnectionState;
  ready: boolean;
}

function connectionTone(connection: ConnectionState): { dot: string; text: string; label: string } {
  if (connection === "online") {
    return { dot: "bg-emerald-400", text: "text-emerald-200", label: "online" };
  }
  if (connection === "checking") {
    return { dot: "bg-sky-400", text: "text-sky-200", label: "checking" };
  }
  return { dot: "bg-rose-400", text: "text-rose-200", label: "offline" };
}

const MODES: Array<{ id: WorkbenchMode; labelKey: string; titleKey: string; testId: string }> = [
  {
    id: "presentation",
    labelKey: "panels:workbench.modePresentation",
    titleKey: "panels:workbench.modePresentationTitle",
    testId: "mode-presentation",
  },
  {
    id: "developer",
    labelKey: "panels:workbench.modeDeveloper",
    titleKey: "panels:workbench.modeDeveloperTitle",
    testId: "mode-developer",
  },
];

export function HeaderBar({ samples, connection, ready }: HeaderBarProps) {
  const { t } = useTranslation(["panels", "toolbar", "common"]);
  const selectedSampleId = useDebugStore((state) => state.selectedSampleId);
  const setSelectedSampleId = useDebugStore((state) => state.setSelectedSampleId);
  const session = useDebugStore((state) => state.session);
  const mode = useDebugStore((state) => state.workbenchMode);
  const setMode = useDebugStore((state) => state.setWorkbenchMode);
  const leftPanelCollapsed = useDebugStore((state) => state.leftPanelCollapsed);
  const rightPanelCollapsed = useDebugStore((state) => state.rightPanelCollapsed);
  const projection = useDebugStore((state) => state.projectionMode);
  const setProjectionMode = useDebugStore((state) => state.setProjectionMode);
  const toggleLeftPanel = useDebugStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useDebugStore((state) => state.toggleRightPanel);
  const tone = connectionTone(connection);

  const connectionLabel =
    connection === "online"
      ? t("toolbar:connectionOnline")
      : connection === "checking"
        ? t("toolbar:connectionChecking")
        : t("toolbar:connectionOffline");

  return (
    <header
      className="flex min-h-[68px] shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-[#182636] bg-[#070d14] px-4 py-2.5"
      data-testid="app-header"
    >
      <div className="flex shrink-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-11 w-11 place-items-center rounded-md border border-emerald-400/45 bg-emerald-500/[0.09] font-mono text-[23px] font-bold text-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.10)]"
        >
          P
        </span>
        <div className="leading-tight">
          <div className="text-[24px] font-semibold tracking-[0.04em] text-[#eef6ff]">
            {t("common:app.name")}
          </div>
          <div className="mt-0.5 hidden text-[12px] uppercase tracking-[0.16em] text-[#667b91] sm:block">
            {t("common:app.subtitle")}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[12px] uppercase tracking-[0.10em] text-[#6e8298]">
            {t("panels:workbench.sample")}
          </span>
          <select
            value={selectedSampleId ?? ""}
            onChange={(event) => setSelectedSampleId(event.target.value)}
            disabled={Boolean(session) || samples.length === 0}
            aria-label={t("toolbar:target")}
            data-testid="sample-select"
            className="h-11 w-[11.5rem] rounded-md border border-[#2b3d51] bg-[#0c1520] px-3 font-mono text-[14px] text-[#dbe7f3] outline-none transition-colors focus:border-cyan-500/60 disabled:opacity-50"
          >
            {samples.length === 0 ? <option value="">{t("toolbar:noSamples")}</option> : null}
            {samples.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.id}
                {sample.binary_exists ? "" : t("toolbar:notBuilt")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-2" title={connectionLabel}>
        <span className={`h-2 w-2 rounded-full ${tone.dot}`} aria-hidden="true" />
        <span className={`text-[13px] font-medium ${tone.text}`}>{connectionLabel}</span>
        <span className="hidden text-[12px] text-[#5f7388] xl:inline">
          {ready ? t("panels:workbench.realGdb") : ""}
        </span>
      </div>

      {session && !projection ? (
        <span
          className="hidden min-w-0 truncate font-mono text-[12px] text-[#6a7f95] 2xl:inline"
          title={session.session_id}
        >
          {t("panels:workbench.sessionShort")} {session.session_id.slice(0, 8)}
        </span>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {mode === "presentation" ? (
          <button
            type="button"
            data-testid="projection-toggle"
            aria-pressed={projection}
            title={t("toolbar:projectionTitle")}
            onClick={() => setProjectionMode(!projection)}
            className={`flex h-11 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors ${
              projection
                ? "border-emerald-400/60 bg-emerald-500/[0.10] text-emerald-200"
                : "border-[#2b3d51] bg-[#0a121b] text-[#7d91a7] hover:bg-[#101c27] hover:text-[#c0d2e4]"
            }`}
          >
            <span aria-hidden="true" className="text-[15px] leading-none">
              {projection ? "🖥" : "🖥"}
            </span>
            {t("toolbar:projection")}
          </button>
        ) : null}
        {mode === "developer" ? (
          <div
            className="flex h-11 items-center rounded-md border border-[#2b3d51] bg-[#0a121b] p-0.5"
            role="group"
            aria-label={t("panels:workbench.modeLabel")}
          >
            <button
              type="button"
              data-testid="toggle-disasm"
              aria-pressed={!leftPanelCollapsed}
              title={
                leftPanelCollapsed
                  ? t("toolbar:showDisasm")
                  : t("toolbar:hideDisasm")
              }
              onClick={toggleLeftPanel}
              className={`h-10 rounded px-2.5 text-[12.5px] font-medium transition-colors ${
                !leftPanelCollapsed
                  ? "bg-[#173246] text-[#dff1ff]"
                  : "text-[#7d91a7] hover:bg-[#101c27] hover:text-[#c0d2e4]"
              }`}
            >
              {t("toolbar:disasmLabel")}
            </button>
            <button
              type="button"
              data-testid="toggle-registers"
              aria-pressed={!rightPanelCollapsed}
              title={
                rightPanelCollapsed
                  ? t("toolbar:showRegs")
                  : t("toolbar:hideRegs")
              }
              onClick={toggleRightPanel}
              className={`h-10 rounded px-2.5 text-[12.5px] font-medium transition-colors ${
                !rightPanelCollapsed
                  ? "bg-[#173246] text-[#dff1ff]"
                  : "text-[#7d91a7] hover:bg-[#101c27] hover:text-[#c0d2e4]"
              }`}
            >
              {t("toolbar:regsLabel")}
            </button>
          </div>
        ) : null}
        <div
          className="flex h-11 items-center rounded-md border border-[#2b3d51] bg-[#0a121b] p-0.5"
          role="group"
          aria-label={t("panels:workbench.modeGroup")}
          data-testid="mode-switch"
        >
          {MODES.map((entry) => {
            const active = mode === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                data-testid={entry.testId}
                aria-pressed={active}
                title={t(entry.titleKey)}
                onClick={() => setMode(entry.id)}
                className={`h-10 rounded px-3 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-[#173246] text-[#dff1ff] shadow-[inset_0_0_0_1px_rgba(125,211,252,0.30)]"
                    : "text-[#7d91a7] hover:bg-[#101c27] hover:text-[#c0d2e4]"
                }`}
              >
                {t(entry.labelKey)}
              </button>
            );
          })}
        </div>
        <LanguageSwitch />
      </div>
    </header>
  );
}
