import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSampleSource } from "../../hooks/useSampleSource";
import { normalizeAddress } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";

type PanelTab = "source" | "disassembly";

function basename(path: string | null): string | null {
  if (!path) return null;
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || null;
}

interface SourceDisassemblyPanelProps {
  defaultTab?: PanelTab;
}

/**
 * Left teaching panel: the sample's real source file (served by the backend from
 * the sample registry) and the real GDB disassembly. The source line highlight
 * uses the frame's DWARF file/line; when it cannot be matched nothing is
 * highlighted instead of guessing.
 */
export function SourceDisassemblyPanel({
  defaultTab = "source",
}: SourceDisassemblyPanelProps) {
  const { t } = useTranslation(["panels", "common"]);
  const [tab, setTab] = useState<PanelTab>(defaultTab);
  const sourceScrollRef = useRef<HTMLDivElement | null>(null);
  const disassemblyScrollRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useDebugStore((state) => state.snapshot);
  const selectedSampleId = useDebugStore((state) => state.selectedSampleId);
  const session = useDebugStore((state) => state.session);
  const selectInstruction = useDebugStore((state) => state.selectInstruction);
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const { source, loading, error } = useSampleSource(
    session?.sample_id ?? selectedSampleId,
  );

  const frame = snapshot?.frames[0] ?? null;
  const sourceName = basename(source?.source_file ?? null);
  const frameFile = basename(frame?.file ?? null);
  const currentLine =
    source && sourceName && frameFile && sourceName === frameFile ? frame?.line ?? null : null;

  const lines = useMemo(
    () => (source ? source.content.replace(/\r?\n$/, "").split(/\r?\n/) : []),
    [source],
  );

  const breakpointAddresses = useMemo(
    () =>
      new Set(
        breakpoints
          .map((breakpoint) => normalizeAddress(breakpoint.address))
          .filter((address): address is string => address !== null),
      ),
    [breakpoints],
  );

  const rip = normalizeAddress(snapshot?.instruction?.address ?? null);

  // Keep the DWARF source line visible without moving the whole page.
  useEffect(() => {
    if (tab !== "source" || currentLine === null) return;
    const container = sourceScrollRef.current;
    if (!container) return;
    const line = container.querySelector<HTMLElement>(
      '[data-testid="source-line"][data-current="true"]',
    );
    if (!line) return;
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    container.scrollTop = Math.max(
      0,
      lineRect.top -
        containerRect.top +
        container.scrollTop -
        container.clientHeight / 2 +
        lineRect.height / 2,
    );
  }, [tab, currentLine, source]);

  // Keep the current RIP visible in the presentation disassembly tab.
  useEffect(() => {
    if (tab !== "disassembly") return;
    const container = disassemblyScrollRef.current;
    if (!container) return;
    const line = container.querySelector<HTMLElement>(
      '[data-testid="disassembly-line"][data-current="true"]',
    );
    if (!line) return;
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    container.scrollTop = Math.max(
      0,
      lineRect.top -
        containerRect.top +
        container.scrollTop -
        container.clientHeight / 2 +
        lineRect.height / 2,
    );
  }, [tab, snapshot?.snapshot_id, rip]);

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[#1b2a3a] bg-[#080f17]"
      data-testid="source-disassembly-panel"
      aria-label={t("panels:source.title")}
    >
      <header className="shrink-0 border-b border-[#1b2a3a] bg-[#0a121b] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[19px] font-semibold text-[#edf5fd]">
            {tab === "source" ? t("panels:source.title") : t("panels:disassembly.title")}
          </h2>
          <span
            className="ml-auto truncate font-mono text-[11.5px] text-[#5f7388]"
            data-testid="source-file-name"
          >
            {tab === "source"
              ? source?.source_file
                ? basename(source.source_file)
                : t("panels:source.title")
              : rip ?? t("panels:disassembly.noRip")}
          </span>
        </div>
        <div
          className="mt-2 flex h-10 items-center rounded-md border border-[#2b3d51] bg-[#0c1520] p-0.5"
          role="tablist"
          aria-label={t("panels:source.title")}
        >
          {(
            [
              { id: "source" as const, key: "panels:source.tabSource" },
              { id: "disassembly" as const, key: "panels:source.tabDisassembly" },
            ] satisfies Array<{ id: PanelTab; key: string }>
          ).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              data-testid={`source-tab-${entry.id}`}
              onClick={() => setTab(entry.id)}
              className={`h-9 flex-1 rounded-sm text-[13px] font-medium transition-colors ${
                tab === entry.id
                  ? "bg-[#173246] text-[#dff1ff]"
                  : "text-[#7d91a7] hover:bg-[#101c27] hover:text-[#c0d2e4]"
              }`}
            >
              {t(entry.key)}
            </button>
          ))}
        </div>
        {source ? (
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-[#5f7388]">
            <span>
              {t("panels:source.lineCount", { count: source.line_count })}
              {source.truncated ? ` · ${t("panels:source.truncated")}` : ""}
            </span>
            {currentLine !== null ? (
              <span className="font-mono text-cyan-300/80">
                {t("panels:source.currentLine")} {currentLine}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "source" ? (
          <div className="h-full min-h-0 overflow-auto" data-testid="source-panel" ref={sourceScrollRef}>
            {loading ? (
              <p className="p-4 text-[14px] text-[#7f93a8]" data-testid="source-loading">
                {t("panels:source.loading")}
              </p>
            ) : null}
            {!loading && error ? (
              <div className="space-y-2 p-4" data-testid="source-error">
                <p className="rounded-md border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2 text-[14px] text-amber-200">
                  {t("panels:source.unavailable")}
                </p>
                <p className="text-[13px] leading-5 text-[#7f93a8]">
                  {t("panels:source.unavailableHint")}
                </p>
                <p className="break-all font-mono text-[11.5px] text-[#5f7388]">{error}</p>
                {frame?.file ? (
                  <p className="break-all font-mono text-[12px] text-[#8fa3b8]">
                    {frame.file}
                    {frame.line !== null ? `:${frame.line}` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
            {!loading && !error && source ? (
              <div className="min-w-max py-1">
                {lines.map((line, index) => {
                  const lineNumber = index + 1;
                  const current = currentLine === lineNumber;
                  return (
                    <div
                      key={lineNumber}
                      data-testid="source-line"
                      data-line={lineNumber}
                      data-current={current ? "true" : "false"}
                      className={`flex min-h-[24px] items-start border-l-2 ${
                        current
                          ? "border-l-cyan-400/80 bg-cyan-500/[0.075]"
                          : "border-l-transparent hover:bg-[#0d1722]"
                      }`}
                    >
                      <span
                        className={`w-12 shrink-0 select-none pr-3 text-right font-mono text-[12.5px] leading-6 tabular-nums ${
                          current ? "text-cyan-300" : "text-[#45586c]"
                        }`}
                      >
                        {lineNumber}
                      </span>
                      <code
                        className={`whitespace-pre py-0.5 pr-6 pl-2 font-mono text-[14px] leading-6 ${
                          current ? "text-[#e8f6ff]" : "text-[#b7c8d9]"
                        }`}
                      >
                        {line || " "}
                      </code>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {!loading && !error && !source ? (
              <p className="p-4 text-[14px] text-[#7f93a8]">
                {t("panels:source.unavailable")}
              </p>
            ) : null}
          </div>
        ) : (
          <div
            className="h-full min-h-0 overflow-auto"
            data-testid="presentation-disassembly"
            ref={disassemblyScrollRef}
          >
            {(snapshot?.disassembly.length ?? 0) === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
                <span className="rounded-md border border-[#2b3d51] px-3 py-1.5 text-[13px] text-[#7f93a8]">
                  {t("panels:disassembly.empty")}
                </span>
                <p className="max-w-xs text-[13px] leading-5 text-[#66798e]">
                  {t("panels:disassembly.emptyHint")}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {snapshot?.disassembly.map((line) => {
                  const address = normalizeAddress(line.address);
                  const current = Boolean(address && rip && address === rip);
                  const hasBreakpoint = Boolean(address && breakpointAddresses.has(address));
                  return (
                    <button
                      key={line.address}
                      type="button"
                      data-testid="disassembly-line"
                      data-current={current ? "true" : "false"}
                      onClick={() => selectInstruction(line.address)}
                      title={line.function ? `${line.function} · ${line.text}` : line.text}
                      className={`flex w-full items-center gap-3 border-l-2 py-1.5 pl-2 pr-3 text-left transition-colors ${
                        current
                          ? "border-l-cyan-400/80 bg-cyan-500/[0.075]"
                          : "border-l-transparent hover:bg-[#0d1722]"
                      }`}
                    >
                      <span
                        className={`w-[7.5rem] shrink-0 font-mono text-[12.5px] tabular-nums ${
                          current ? "text-cyan-300" : "text-[#5f7388]"
                        }`}
                      >
                        {line.address}
                      </span>
                      <span className="w-4 shrink-0 text-center text-[12px]">
                        {current ? (
                          <span className="text-cyan-300" aria-label={t("panels:disassembly.currentInstruction")}>
                            ▶
                          </span>
                        ) : hasBreakpoint ? (
                          <span className="text-rose-400" aria-label={t("panels:disassembly.breakpoint")}>
                            ●
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`min-w-0 truncate font-mono text-[14.5px] ${
                          current ? "text-[#e8f6ff]" : "text-[#b7c8d9]"
                        }`}
                      >
                        {line.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
