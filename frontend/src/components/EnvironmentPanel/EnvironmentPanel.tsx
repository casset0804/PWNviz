import type { ReactNode } from "react";
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
  { tone: Tone; label: string }
> = {
  not_found: { tone: "idle", label: "not found - native GDB only" },
  detected: { tone: "info", label: "found on disk, not loaded" },
  verified: { tone: "ok", label: "loaded and verified" },
  load_failed: { tone: "error", label: "found, failed to load" },
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
  const pwndbg = capabilities?.pwndbg;
  const pwndbgStatus = pwndbg ? PWNDBG_STATUS[pwndbg.status] : null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={error ? "error" : loading ? "info" : "ok"}>
          {error ? "probe failed" : loading ? "probing host" : "probe complete"}
        </StatusBadge>
        {capabilities ? (
          <StatusBadge tone={capabilities.ready ? "ok" : "warn"}>
            {capabilities.ready
              ? "ready for real sessions"
              : "not ready for real sessions"}
          </StatusBadge>
        ) : null}
        {capabilities ? (
          <span className="font-mono text-[10px] text-slate-600">
            generated {capabilities.generated_at}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || verifying}
            className="rounded border border-[#263044] bg-[#111722] px-2.5 py-1 font-mono text-[11px] text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {loading ? "probing..." : "re-probe"}
          </button>
          <button
            type="button"
            onClick={onVerifyPwndbg}
            disabled={loading || verifying || !pwndbg || pwndbg.status === "not_found"}
            title="Load pwndbg into a throwaway GDB process to prove it works"
            className="rounded border border-emerald-700/50 bg-emerald-900/20 px-2.5 py-1 font-mono text-[11px] text-emerald-300 hover:border-emerald-500 disabled:opacity-40"
          >
            {verifying ? "verifying pwndbg..." : "verify pwndbg load"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-[11px] font-semibold text-rose-300">
            Cannot reach the PWNviz backend
          </p>
          <p className="mt-1 font-mono text-[11px] leading-5 text-rose-200/80">
            {error}
          </p>
          <p className="mt-2 font-mono text-[10px] text-slate-500">
            wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/dev_backend.sh
          </p>
        </div>
      ) : null}

      {!capabilities && !error ? (
        <p className="font-mono text-[11px] text-slate-500">
          Running real host probes: gdb --version, embedded Python, MI3 support,
          pwndbg detection and sample discovery...
        </p>
      ) : null}

      {capabilities ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <Card
              title="GDB"
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
                      ? "usable"
                      : "too old"
                    : "missing"}
                </StatusBadge>
              }
            >
              <Row label="version">
                {capabilities.gdb.version ?? "not found"}
              </Row>
              <Row label="minimum">{capabilities.gdb.minimum_version}</Row>
              <Row label="path">{capabilities.gdb.path ?? "-"}</Row>
              <Row label="MI3">
                {capabilities.gdb.supports_mi3 ? "accepted" : "rejected"}
              </Row>
              <Row label="gdb python">
                {capabilities.gdb.python.available
                  ? capabilities.gdb.python.version
                  : "unavailable"}
              </Row>
              <Row label="probe">
                {capabilities.gdb.duration_ms ?? "-"} ms
              </Row>
              {capabilities.gdb.error ? (
                <p className="mt-2 font-mono text-[10px] leading-4 text-rose-300/80">
                  {capabilities.gdb.error}
                </p>
              ) : null}
            </Card>

            <Card
              title="pwndbg"
              status={
                pwndbgStatus ? (
                  <StatusBadge tone={pwndbgStatus.tone}>
                    {pwndbgStatus.label}
                  </StatusBadge>
                ) : null
              }
            >
              <Row label="enabled">{pwndbg?.enabled ? "yes" : "no (config)"}</Row>
              <Row label="version">{pwndbg?.version ?? "-"}</Row>
              <Row label="install">{pwndbg?.path ?? "not detected"}</Row>
              <Row label="gdbinit">{pwndbg?.gdbinit ?? "-"}</Row>
              {pwndbg?.detail ? (
                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  {pwndbg.detail}
                </p>
              ) : null}
            </Card>

            <Card title="Host & Python">
              <Row label="os">
                {capabilities.platform.system} {capabilities.platform.release}
              </Row>
              <Row label="machine">{capabilities.platform.machine}</Row>
              <Row label="hostname">{capabilities.platform.hostname}</Row>
              <Row label="backend py">
                {capabilities.python.backend_version}
              </Row>
              <Row label="gdb py">
                {capabilities.python.gdb_embedded_version ?? "-"}
              </Row>
            </Card>

            <Card
              title="Samples"
              status={
                <StatusBadge tone={capabilities.samples.count > 0 ? "ok" : "warn"}>
                  {capabilities.samples.count} found
                </StatusBadge>
              }
            >
              <p className="mb-2 truncate font-mono text-[10px] text-slate-600">
                {capabilities.samples.directory}
              </p>
              <ul className="space-y-1">
                {samples.map((sample) => (
                  <li
                    key={sample.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-mono text-[11px] text-slate-300">
                      {sample.id}
                    </span>
                    <StatusBadge tone={sample.binary_exists ? "ok" : "warn"}>
                      {sample.binary_exists
                        ? formatBytes(sample.binary_size)
                        : "not built"}
                    </StatusBadge>
                  </li>
                ))}
                {samples.length === 0 ? (
                  <li className="font-mono text-[11px] text-slate-600">
                    no sample directories with demo.c
                  </li>
                ) : null}
              </ul>
            </Card>
          </div>

          {capabilities.warnings.length > 0 ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                Warnings ({capabilities.warnings.length})
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
              No warnings: GDB, MI3 and the embedded Python interpreter are all
              usable.
            </div>
          )}

          <details className="rounded border border-[#1e2635] bg-[#0a0e14] p-3">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
              raw probe payload
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
