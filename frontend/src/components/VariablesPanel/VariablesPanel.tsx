import { useState } from "react";

import { normalizeAddress } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";
import type { VariableLocationKind, VariableNode } from "../../types/debug";
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

function kindLabel(kind: string): string {
  return kind === "scalar" ? "value" : kind;
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
  const [expanded, setExpanded] = useState(depth === 0);
  const selectByte = useDebugStore((state) => state.selectByte);
  const requestScroll = useDebugStore((state) => state.requestScroll);
  const jumpToPointer = useDebugStore((state) => state.jumpToPointer);
  const address = normalizeAddress(node.address);
  const target = normalizeAddress(node.pointer_target);
  const hasChildren = node.children.length > 0;

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
              aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
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
            {node.value ?? (node.location_kind === "optimized_out" ? "<optimized out>" : "—")}
          </span>
          <StatusBadge tone={locationTone(node.location_kind)}>
            {node.location_kind}
          </StatusBadge>
          <span className="font-mono text-[9px] uppercase tracking-wide text-slate-600">
            {kindLabel(node.kind)} · {node.source}/{node.confidence}
          </span>
          {node.is_argument ? <span className="text-[9px] text-amber-300/80">arg</span> : null}
        </div>

        {node.string_value ? (
          <div className="ml-6 mt-1 font-mono text-[10px] text-emerald-200/80">
            string: <span className="text-emerald-100">{node.string_value}</span>
          </div>
        ) : null}

        <div className="ml-6 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-slate-600">
          {address ? (
            <button
              type="button"
              onClick={() => selectAddress(address)}
              className="text-cyan-300/80 hover:text-cyan-100"
              title="Inspect this variable's address in the stack window"
            >
              address {address}
            </button>
          ) : (
            <span>address —</span>
          )}
          {node.pointer_target ? (
            <button
              type="button"
              onClick={() => jumpToPointer(node)}
              className="text-sky-300 hover:text-sky-100"
              title="Inspect bounded pointer target bytes"
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
            >
              {node.target_readable === true
                ? "target readable"
                : node.target_readable === false
                  ? "target invalid/unreadable"
                  : "target not read (limit)"}
            </span>
          ) : null}
          {node.target_string ? (
            <span className="text-emerald-200/80">target string: {node.target_string}</span>
          ) : null}
          {hasChildren ? (
            <span>
              {node.children.length} child{node.children.length === 1 ? "" : "ren"}
            </span>
          ) : null}
        </div>

        {node.pointer_target && node.target_bytes ? (
          <div className="ml-6 mt-1 truncate font-mono text-[9px] text-slate-600" title={node.target_bytes}>
            target bytes: {node.target_bytes.slice(0, 96)}
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

export function VariablesPanel() {
  const snapshot = useDebugStore((state) => state.snapshot);
  const pointerTarget = useDebugStore((state) => state.pointerTarget);

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col gap-2 p-4" data-testid="variables-panel">
        <StatusBadge tone="idle">no snapshot</StatusBadge>
        <p className="text-[11px] text-slate-500">
          Stop a real process to inspect DWARF-backed locals and arguments.
        </p>
      </div>
    );
  }

  if (!snapshot.variables_available) {
    return (
      <div className="space-y-2 p-4" data-testid="variables-panel">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warn">no DWARF variables</StatusBadge>
          <span className="font-mono text-[10px] text-slate-500">
            raw stack / registers remain available
          </span>
        </div>
        <p className="max-w-3xl text-[11px] leading-5 text-slate-500">
          GDB did not provide debug-info-backed variables for this frame. PWNviz does not
          infer variable storage from raw QWORDs; the Stack Memory Canvas and Registers
          remain the authoritative raw views.
        </p>
        {snapshot.warnings
          .filter((warning) => warning.toLowerCase().includes("dwarf"))
          .slice(0, 4)
          .map((warning) => (
            <p key={warning} className="font-mono text-[10px] text-amber-200/80">
              • {warning}
            </p>
          ))}
      </div>
    );
  }

  if (snapshot.variables.length === 0) {
    return (
      <div className="flex h-full flex-col gap-2 p-4" data-testid="variables-panel">
        <StatusBadge tone="info">debug info present</StatusBadge>
        <p className="font-mono text-[11px] text-slate-500">
          No locals or arguments were reported for frame 0.
        </p>
      </div>
    );
  }

  const argumentsCount = snapshot.variables.filter((node) => node.is_argument).length;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="variables-panel">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#1e2635] px-3 py-1.5">
        <StatusBadge tone="ok">DWARF / GDB MI</StatusBadge>
        <span className="font-mono text-[10px] text-slate-500">
          frame 0 · {snapshot.variables.length} roots · {argumentsCount} argument(s)
        </span>
        <span className="ml-auto font-mono text-[9px] text-slate-600">
          source=dwarf confidence=debug-info · pointer targets are bounded GDB memory reads
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <ul className="space-y-1.5">
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

      {pointerTarget ? (
        <div className="shrink-0 border-t border-[#1e2635] px-3 py-1 font-mono text-[10px] text-slate-500">
          pointer target selected: {pointerTarget.variableName} →{" "}
          {pointerTarget.address ?? "unavailable"} ·{" "}
          {pointerTarget.readable === true
            ? `${pointerTarget.bytes?.length ?? 0} hex chars read`
            : "invalid/unreadable/not read"}
        </div>
      ) : null}
    </div>
  );
}
