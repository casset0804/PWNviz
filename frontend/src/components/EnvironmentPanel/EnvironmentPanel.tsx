import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Capabilities, SampleInfo } from "../../types/api";
import { StatusBadge, type Tone } from "../common/StatusBadge";

interface EnvironmentPanelProps {
  capabilities: Capabilities | null;
  samples: SampleInfo[];
  error: string | null;
  loading: boolean;
  verifying: boolean;
  onRefresh: () => void;
  onVerifyPwndbg: () => void;
}

const PWNDBG_STATUS: Record<
  Capabilities["pwndbg"]["status"],
  { tone: Tone; key: string }
> = {
  not_found: { tone: "idle", key: "panels:environment.pwndbgNotFound" },
  detected: { tone: "info", key: "panels:environment.pwndbgDetected" },
  verified: { tone: "ok", key: "panels:environment.pwndbgVerified" },
  load_failed: { tone: "error", key: "panels:environment.pwndbgLoadFailed" },
};

function formatBytes(size: number | null): string {
  if (size === null) return "-";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KiB`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#161d28] py-1 last:border-b-0">
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-slate-600">
        {label}
      </span>
      <span className="min-w-0 truncate text-right font-mono text-[11px] text-slate-300">
        {children}
      </span>
    </div>
  );
}

function Card({
  title,
  status,
  children,
}: {
  title: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          {title}
        </h3>
        {status}
      </div>
      {children}
    </div>
  );
}

export function EnvironmentPanel({
  capabilities,
  samples,
  error,
  loading,
  verifying,
  onRefresh,
  onVerifyPwndbg,
}: EnvironmentPanelProps) {
  const { t } = useTranslation(["panels", "common"]);
  const pwndbg = capabilities?.pwndbg;
  const pwndbgStatus = pwndbg ? PWNDBG_STATUS[pwndbg.status] : null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={error ? "error" : loading ? "info" : "ok"}>
          {error
            ? t("panels:environment.failed")
            : loading
              ? t("panels:environment.probing")
              : t("panels:environment.complete")}
        </StatusBadge>
        {capabilities ? (
          <StatusBadge tone={capabilities.ready ? "ok" : "warn"}>
            {capabilities.ready
              ? t("panels:environment.ready")
              : t("panels:environment.notReady")}
          </StatusBadge>
        ) : null}
        {capabilities ? (
          <span className="font-mono text-[10px] text-slate-600">
            {t("panels:environment.generated", {
              time: capabilities.generated_at,
            })}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || verifying}
            className="rounded border border-[#263044] bg-[#111722] px-2.5 py-1 font-mono text-[11px] text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {loading
              ? t("panels:environment.reprobing")
              : t("panels:environment.reprobe")}
          </button>
          <button
            type="button"
            onClick={onVerifyPwndbg}
            disabled={loading || verifying || !pwndbg || pwndbg.status === "not_found"}
            title={t("panels:environment.verifyTitle")}
            className="rounded border border-emerald-700/50 bg-emerald-900/20 px-2.5 py-1 font-mono text-[11px] text-emerald-300 hover:border-emerald-500 disabled:opacity-40"
          >
            {verifying
              ? t("panels:environment.verifying")
              : t("panels:environment.verifyPwndbg")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-[11px] font-semibold text-rose-300">
            {t("panels:environment.unreachable")}
          </p>
          <p className="mt-1 font-mono text-[11px] leading-5 text-rose-200/80">
            {error}
          </p>
          <p className="mt-2 font-mono text-[10px] text-slate-500">
            {t("panels:environment.runBackend")}
          </p>
        </div>
      ) : null}

      {!capabilities && !error ? (
        <p className="font-mono text-[11px] text-slate-500">
          {t("panels:environment.probingBody")}
        </p>
      ) : null}

      {capabilities ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <Card
              title={t("panels:environment.gdb")}
              status={
                <StatusBadge
                  tone={
                    capabilities.gdb.available && capabilities.gdb.supported
                      ? "ok"
                      : "error"
                  }
                >
                  {capabilities.gdb.available
                    ? capabilities.gdb.supported
                      ? t("panels:environment.usable")
                      : t("panels:environment.tooOld")
                    : t("panels:environment.missing")}
                </StatusBadge>
              }
            >
              <Row label={t("panels:environment.version")}>
                {capabilities.gdb.version ?? t("panels:environment.notDetected")}
              </Row>
              <Row label={t("panels:environment.minimum")}>
                {capabilities.gdb.minimum_version}
              </Row>
              <Row label={t("panels:environment.path")}>
                {capabilities.gdb.path ?? "-"}
              </Row>
              <Row label={t("panels:environment.mi3")}>
                {capabilities.gdb.supports_mi3
                  ? t("panels:environment.accepted")
                  : t("panels:environment.rejected")}
              </Row>
              <Row label={t("panels:environment.gdbPython")}>
                {capabilities.gdb.python.available
                  ? capabilities.gdb.python.version
                  : t("panels:environment.unavailable")}
              </Row>
              <Row label={t("panels:environment.probe")}>
                {capabilities.gdb.duration_ms ?? "-"} ms
              </Row>
              {capabilities.gdb.error ? (
                <p className="mt-2 font-mono text-[10px] leading-4 text-rose-300/80">
                  {capabilities.gdb.error}
                </p>
              ) : null}
            </Card>

            <Card
              title={t("panels:environment.pwndbg")}
              status={
                pwndbgStatus ? (
                  <StatusBadge tone={pwndbgStatus.tone}>
                    {t(pwndbgStatus.key)}
                  </StatusBadge>
                ) : null
              }
            >
              <Row label={t("panels:environment.enabled")}>
                {pwndbg?.enabled
                  ? t("panels:environment.pwndbgEnabledYes")
                  : t("panels:environment.pwndbgEnabledNo")}
              </Row>
              <Row label={t("panels:environment.version")}>
                {pwndbg?.version ?? "-"}
              </Row>
              <Row label={t("panels:environment.install")}>
                {pwndbg?.path ?? t("panels:environment.notDetected")}
              </Row>
              <Row label="gdbinit">{pwndbg?.gdbinit ?? "-"}</Row>
              {pwndbg?.detail ? (
                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  {pwndbg.detail}
                </p>
              ) : null}
            </Card>

            <Card
              title={t("panels:environment.host")}
              status={
                <StatusBadge tone={capabilities.platform.is_x86_64 ? "ok" : "error"}>
                  {capabilities.platform.is_x86_64
                    ? "x86-64"
                    : t("panels:environment.notReady")}
                </StatusBadge>
              }
            >
              <Row label={t("panels:environment.os")}>
                {capabilities.platform.system} {capabilities.platform.release}
              </Row>
              <Row label={t("panels:environment.architecture")}>
                {capabilities.platform.architecture}
              </Row>
              <Row label={t("panels:environment.machine")}>
                {capabilities.platform.machine}
              </Row>
              <Row label={t("panels:environment.x86Check")}>
                {capabilities.platform.is_x86_64
                  ? t("panels:environment.yes")
                  : t("panels:environment.no")}
              </Row>
              <Row label={t("panels:environment.hostname")}>
                {capabilities.platform.hostname}
              </Row>
              <Row label={t("panels:environment.backendPy")}>
                {capabilities.python.backend_version}
              </Row>
              <Row label={t("panels:environment.gdbPython")}>
                {capabilities.python.gdb_embedded_version ?? "-"}
              </Row>
            </Card>

            <Card
              title={t("panels:environment.samples")}
              status={
                <StatusBadge tone={capabilities.samples.count > 0 ? "ok" : "warn"}>
                  {t("panels:environment.samplesFound", {
                    count: capabilities.samples.count,
                  })}
                </StatusBadge>
              }
            >
              <p className="mb-2 truncate font-mono text-[10px] text-slate-600">
                {capabilities.samples.directory}
              </p>
              <ul className="space-y-1">
                {samples.map((sample) => (
                  <li key={sample.id} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px] text-slate-300">
                      {sample.id}
                    </span>
                    <StatusBadge tone={sample.binary_exists ? "ok" : "warn"}>
                      {sample.binary_exists
                        ? formatBytes(sample.binary_size)
                        : t("panels:environment.notBuilt")}
                    </StatusBadge>
                  </li>
                ))}
                {samples.length === 0 ? (
                  <li className="font-mono text-[11px] text-slate-600">
                    {t("panels:environment.noSamples")}
                  </li>
                ) : null}
              </ul>
            </Card>
          </div>

          {capabilities.warnings.length > 0 ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                {t("panels:environment.warningsCount", {
                  count: capabilities.warnings.length,
                })}
              </h3>
              <ul className="mt-1 space-y-1">
                {capabilities.warnings.map((warning) => (
                  <li
                    key={warning}
                    className="font-mono text-[10px] leading-4 text-amber-200/80"
                  >
                    - {warning}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] text-emerald-300/80">
              {t("panels:environment.noWarnings")}
            </div>
          )}

          <details className="rounded border border-[#1e2635] bg-[#0a0e14] p-3">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
              {t("panels:environment.rawPayload")}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto font-mono text-[10px] leading-4 text-slate-400">
              {JSON.stringify(capabilities, null, 2)}
            </pre>
          </details>
        </>
      ) : null}
    </div>
  );
}
