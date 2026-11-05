import { useState } from "react";
import { useTranslation } from "react-i18next";

import { normalizeAddress } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";
import type {
  VariableLocationKind,
  VariablesState,
  VariableNode,
} from "../../types/debug";
import { StatusBadge } from "../common/StatusBadge";

function locationTone(kind: VariableLocationKind) {
  switch (kind) {
    case "memory":
      return "ok" as const;
    case "register":
      return "info" as const;
    case "optimized_out":
      return "warn" as const;
    case "unavailable":
      return "error" as const;
    default:
      return "idle" as const;
  }
}

const LOCATION_KEYS: Record<VariableLocationKind, string> = {
  memory: "panels:variables.locationMemory",
  register: "panels:variables.locationRegister",
  optimized_out: "panels:variables.locationOptimizedOut",
  unavailable: "panels:variables.locationUnavailable",
  unknown: "panels:variables.locationUnknown",
};

function stateBadge(
  state: VariablesState,
  t: (key: string, params?: Record<string, unknown>) => string,
  version: number,
): string {
  if (state === "cached") return t("panels:variables.cachedBadge", { version });
  if (state === "updated") return t("panels:variables.stateUpdated");
  return t("panels:variables.stateFull");
}

function VariableRow({
  node,
  pathKey,
  depth,
}: {
  node: VariableNode;
  pathKey: string;
  depth: number;
}) {
  const { t } = useTranslation(["panels", "common"]);
  const [expanded, setExpanded] = useState(depth === 0);
  const selectByte = useDebugStore((state) => state.selectByte);
  const requestScroll = useDebugStore((state) => state.requestScroll);
  const jumpToPointer = useDebugStore((state) => state.jumpToPointer);
  const address = normalizeAddress(node.address);
  const target = normalizeAddress(node.pointer_target);
  const hasChildren = node.children.length > 0;
  const kindLabel =
    node.kind === "scalar" ? t("panels:variables.kindValue") : node.kind;

  const selectAddress = (value: string) => {
    selectByte(value);
    requestScroll(value);
  };

  return (
    <li className="list-none" data-testid="variable-row" data-name={node.name}>
      <div
        className={`rounded border-l-2 px-2 py-1.5 ${
          depth === 0
            ? "border-l-cyan-500/50 bg-[#101721]"
            : "border-l-[#243044] bg-[#0c1118]"
        }`}
        style={{ marginLeft: `${Math.min(depth, 4) * 12}px` }}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-4 shrink-0 font-mono text-[10px] text-slate-500 hover:text-slate-200"
              aria-label={
                expanded
                  ? t("panels:variables.collapse", { name: node.name })
                  : t("panels:variables.expand", { name: node.name })
              }
              aria-expanded={expanded}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span
            className={`font-mono text-[11px] ${
              node.is_argument ? "text-amber-200" : "text-cyan-200"
            }`}
          >
            {node.name}
          </span>
          <span className="font-mono text-[10px] text-slate-500">{node.type}</span>
          <span className="font-mono text-[10px] text-slate-200">
            {node.value ??
              (node.location_kind === "optimized_out"
                ? t("panels:variables.optimizedOut")
                : "—")}
          </span>
          <StatusBadge tone={locationTone(node.location_kind)}>
            {t(LOCATION_KEYS[node.location_kind] ?? "panels:variables.locationUnknown")}
          </StatusBadge>
          <span className="font-mono text-[9px] uppercase tracking-wide text-slate-600">
            {t("panels:variables.provenance", {
              kind: kindLabel,
              source: node.source,
              confidence: node.confidence,
            })}
          </span>
          {node.is_argument ? (
            <span className="text-[9px] text-amber-300/80">
              {t("panels:variables.argument")}
            </span>
          ) : null}
        </div>

        {node.string_value ? (
          <div className="ml-6 mt-1 font-mono text-[10px] text-emerald-200/80">
            {t("panels:variables.string")}:{" "}
            <span className="text-emerald-100">{node.string_value}</span>
          </div>
        ) : null}

        <div className="ml-6 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-slate-600">
          {address ? (
            <button
              type="button"
              onClick={() => selectAddress(address)}
              className="text-cyan-300/80 hover:text-cyan-100"
              title={t("panels:variables.addressTitle")}
            >
              {t("panels:variables.address")} {address}
            </button>
          ) : (
            <span>{t("panels:variables.address")} —</span>
          )}
          {node.pointer_target ? (
            <button
              type="button"
              onClick={() => jumpToPointer(node)}
              className="text-sky-300 hover:text-sky-100"
              title={t("panels:variables.inspectTarget")}
              data-testid="pointer-target"
            >
              → {target ?? node.pointer_target}
            </button>
          ) : null}
          {node.pointer_target ? (
            <span
              className={
                node.target_readable === true
                  ? "text-emerald-300/80"
                  : node.target_readable === false
                    ? "text-rose-300/80"
                    : "text-slate-500"
              }
              title={node.target_source ?? undefined}
            >
              {node.target_readable === true
                ? t("panels:variables.targetReadable")
                : node.target_readable === false
                  ? t("panels:variables.targetInvalid")
                  : node.target_source === "cache"
                    ? t("panels:variables.targetCached")
                    : t("panels:variables.targetNotRead")}
            </span>
          ) : null}
          {node.target_string ? (
            <span className="text-emerald-200/80">
              {t("panels:variables.targetString")}: {node.target_string}
            </span>
          ) : null}
          {hasChildren ? (
            <span>{t("panels:variables.children", { count: node.children.length })}</span>
          ) : null}
        </div>

        {node.pointer_target && node.target_bytes ? (
          <div
            className="ml-6 mt-1 truncate font-mono text-[9px] text-slate-600"
            title={node.target_bytes}
          >
            {t("panels:variables.targetBytes")}: {node.target_bytes.slice(0, 96)}
            {node.target_bytes.length > 96 ? "…" : ""}
          </div>
        ) : null}
      </div>

      {expanded && hasChildren ? (
        <ul className="mt-1 space-y-1">
          {node.children.map((child, index) => (
            <VariableRow
              key={`${pathKey}/${child.name}/${index}`}
              node={child}
              pathKey={`${pathKey}/${child.name}/${index}`}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function RefreshVariablesButton() {
  const { t } = useTranslation(["panels", "settings"]);
  const busy = useDebugStore((state) => state.busy);
  const refreshVariables = useDebugStore((state) => state.refreshVariables);
  return (
    <button
      type="button"
      onClick={() => void refreshVariables()}
      disabled={busy}
      data-testid="refresh-variables"
      title={t("settings:refreshVariablesTitle")}
      className="rounded border border-cyan-700/50 bg-cyan-900/20 px-2 py-0.5 font-mono text-[10px] text-cyan-200 hover:border-cyan-500 disabled:opacity-40"
    >
      {busy ? t("panels:variables.refreshing") : t("panels:variables.refresh")}
    </button>
  );
}

export function VariablesPanel() {
  const { t } = useTranslation(["panels", "common"]);
  const snapshot = useDebugStore((state) => state.snapshot);
  const pointerTarget = useDebugStore((state) => state.pointerTarget);

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col gap-2 p-4" data-testid="variables-panel">
        <StatusBadge tone="idle">{t("panels:variables.noSnapshot")}</StatusBadge>
        <p className="text-[11px] text-slate-500">
          {t("panels:variables.noSnapshotHint")}
        </p>
      </div>
    );
  }

  const state: VariablesState = snapshot.variables_state ?? "full";
  const version = snapshot.variables_version ?? snapshot.snapshot_id;

  // Fast snapshots do not build the tree; without cached objects there is
  // nothing truthful to show, so say so and offer the explicit refresh.
  if (state === "deferred") {
    return (
      <div className="space-y-2 p-4" data-testid="variables-panel" data-state={state}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="info">{t("panels:variables.deferredBadge")}</StatusBadge>
          <RefreshVariablesButton />
        </div>
        <p className="max-w-3xl text-[11px] leading-5 text-slate-500">
          {t("panels:variables.deferredBody")}
        </p>
      </div>
    );
  }

  if (!snapshot.variables_available || state === "unavailable") {
    return (
      <div
        className="space-y-2 p-4"
        data-testid="variables-panel"
        data-state="unavailable"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warn">{t("panels:variables.noDwarf")}</StatusBadge>
          <span className="font-mono text-[10px] text-slate-500">
            {t("panels:variables.rawAvailable")}
          </span>
          <RefreshVariablesButton />
        </div>
        <p className="max-w-3xl text-[11px] leading-5 text-slate-500">
          {t("panels:variables.noDwarfBody")}
        </p>
        {snapshot.warnings
          .filter((warning) => warning.toLowerCase().includes("dwarf"))
          .slice(0, 4)
          .map((warning) => (
            <p key={warning} className="font-mono text-[10px] text-amber-200/80">
              • {warning}
            </p>
          ))}
        {pointerTarget ? (
          <p className="font-mono text-[10px] text-slate-500">
            {pointerTarget.variableName}: {pointerTarget.type}
          </p>
        ) : null}
      </div>
    );
  }

  if (snapshot.variables.length === 0) {
    return (
      <div
        className="flex h-full flex-col gap-2 p-4"
        data-testid="variables-panel"
        data-state={state}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="idle">{t("panels:variables.emptyTitle")}</StatusBadge>
          <RefreshVariablesButton />
        </div>
        <p className="text-[11px] text-slate-500">{t("panels:variables.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3" data-testid="variables-panel" data-state={state}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={state === "cached" ? "warn" : "ok"}>
          {stateBadge(state, t, version)}
        </StatusBadge>
        <span className="font-mono text-[10px] text-slate-600">
          {t("panels:variables.warnings")}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {state === "updated" ? (
            <span className="font-mono text-[9px] uppercase tracking-wide text-emerald-300/70">
              −var-update
            </span>
          ) : null}
          <RefreshVariablesButton />
        </span>
      </div>

      {state === "cached" ? (
        <p className="border-l-2 border-amber-500/40 bg-amber-500/[0.04] px-2 py-1 font-mono text-[10px] text-amber-200/80">
          {t("panels:variables.cachedBody")}
        </p>
      ) : null}

      <ul className="space-y-1">
        {snapshot.variables.map((node, index) => (
          <VariableRow
            key={`${node.name}/${index}`}
            node={node}
            pathKey={`${node.name}/${index}`}
            depth={0}
          />
        ))}
      </ul>
    </div>
  );
}
