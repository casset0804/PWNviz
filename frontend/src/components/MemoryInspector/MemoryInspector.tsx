import { useDebugStore } from "../../stores/debugStore";
import { changedBytesMap, findCell } from "../../lib/snapshot";
import { addressInWindow } from "../../lib/address";
import { StatusBadge } from "../common/StatusBadge";

export function MemoryInspector() {
  const snapshot = useDebugStore((state) => state.snapshot);
  const selectedAddress = useDebugStore((state) => state.selectedByteAddress);
  const pointerTarget = useDebugStore((state) => state.pointerTarget);
  const selectedInstructionAddress = useDebugStore(
    (state) => state.selectedInstructionAddress,
  );

  const cell = findCell(snapshot, selectedAddress);
  const changed = changedBytesMap(snapshot);
  const change = cell ? changed.get(cell.address) : undefined;
  const selectedInstruction =
    snapshot?.instruction &&
    selectedInstructionAddress &&
    snapshot.instruction.address === selectedInstructionAddress
      ? snapshot.instruction
      : snapshot?.disassembly.find(
          (line) => line.address === selectedInstructionAddress,
        ) ?? null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={cell ? "ok" : "idle"}>
          {cell ? "byte selected" : "no cell selected"}
        </StatusBadge>
        <span className="text-[11px] text-slate-500">
          Click any stack byte cell to inspect it. Values are taken directly from the current
          snapshot.
        </span>
      </div>

      {!snapshot ? (
        <p className="font-mono text-[11px] text-slate-600">
          No snapshot yet. Launch a session and stop at main.
        </p>
      ) : null}

      {pointerTarget ? (
        <section className="rounded border border-sky-500/30 bg-sky-500/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-sky-300/80">
              pointer target
            </span>
            <span className="font-mono text-[11px] text-slate-200">
              {pointerTarget.variableName}: {pointerTarget.type}
            </span>
            <StatusBadge
              tone={
                pointerTarget.readable === true
                  ? "ok"
                  : pointerTarget.readable === false
                    ? "error"
                    : "idle"
              }
            >
              {pointerTarget.readable === true
                ? "readable"
                : pointerTarget.readable === false
                  ? "invalid / unreadable"
                  : "not read (limit)"}
            </StatusBadge>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="font-mono text-[10px] text-slate-400">
              address: {pointerTarget.address ?? "unavailable"}
              <br />
              source: {pointerTarget.source ?? "unknown"}
            </div>
            <div className="min-w-0 font-mono text-[10px] text-slate-400">
              string: {pointerTarget.stringValue ?? "—"}
            </div>
          </div>
          {pointerTarget.bytes ? (
            <div className="mt-2 break-all font-mono text-[10px] text-slate-300">
              bytes: {pointerTarget.bytes}
            </div>
          ) : null}
          <p className="mt-1 text-[9px] text-slate-500">
            Pointer target reads are capped at 64 bytes by the backend; this is not an
            unbounded dereference.
          </p>
        </section>
      ) : null}

      {cell ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              address
            </div>
            <div className="mt-1 break-all font-mono text-[12px] text-cyan-200" data-testid="inspector-address">
              {cell.address}
            </div>
            <div className="mt-2 text-[10px] text-slate-600">
              byte offset {cell.offset} in row {cell.row.address}
            </div>
          </div>
          <div className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              byte
            </div>
            <div
              className={`mt-1 font-mono text-[18px] ${
                cell.byte === null ? "text-rose-300" : "text-slate-100"
              }`}
              data-testid="inspector-byte"
            >
              {cell.byte ?? "unreadable"}
            </div>
            <div className="mt-2 text-[10px] text-slate-600">
              {cell.byte === null
                ? "GDB could not read this byte; shown as unknown, not zero."
                : `decimal ${parseInt(cell.byte, 16)}`}
            </div>
          </div>
          <div className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              qword (little-endian)
            </div>
            <div className="mt-1 break-all font-mono text-[12px] text-slate-200">
              {cell.row.qword_le ?? "unreadable"}
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-slate-600" title={cell.row.ascii ?? ""}>
              ASCII {cell.row.ascii ?? "unreadable"}
            </div>
          </div>
          <div className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              row / diff
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-300">
              {cell.row.readable ? "readable" : "unknown bytes"}
            </div>
            <div className="mt-1 font-mono text-[10px] text-slate-500">
              range {cell.row.address} + 8 bytes
            </div>
            {change ? (
              <div className="mt-2 font-mono text-[10px] text-emerald-300">
                {change.before ?? "unknown"} → {change.after ?? "unknown"}
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-slate-600">unchanged vs previous snapshot</div>
            )}
          </div>
        </div>
      ) : null}

      {selectedInstruction ? (
        <div className="rounded border border-amber-500/25 bg-amber-500/5 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-amber-300/80">
            selected instruction
          </div>
          <div className="mt-1 font-mono text-[12px] text-slate-200">
            {selectedInstruction.address} · {selectedInstruction.text}
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            Selection only; no breakpoint is created.
          </div>
        </div>
      ) : null}

      {cell && !addressInWindow(cell.address, snapshot?.stack.range_start ?? null, snapshot?.stack.range_end ?? null) ? (
        <p className="font-mono text-[10px] text-rose-300">
          Selected address is outside the current stack window.
        </p>
      ) : null}

      {snapshot?.warnings.length ? (
        <ul className="space-y-1 rounded border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-[10px] text-amber-200/80">
          {snapshot.warnings.slice(0, 5).map((warning) => (
            <li key={warning}>• {warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
