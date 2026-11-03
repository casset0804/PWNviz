import { signedHexDelta } from "../../lib/address";
import { useDebugStore } from "../../stores/debugStore";
import { StatusBadge } from "../common/StatusBadge";

export function ExplanationPanel() {
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const selectedInstructionAddress = useDebugStore(
    (state) => state.selectedInstructionAddress,
  );

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col gap-2 p-4">
        <StatusBadge tone="idle">no snapshot</StatusBadge>
        <p className="max-w-2xl text-[11px] leading-5 text-slate-500">
          Explanations are generated only from a real before/after snapshot. No instruction
          simulator or guessed semantics are used.
        </p>
      </div>
    );
  }

  const selected =
    snapshot.disassembly.find((line) => line.address === selectedInstructionAddress) ?? null;
  const instruction = snapshot.instruction;
  const changedRegisters = snapshot.diff.changed_registers;
  const changedBytes = snapshot.diff.changed_bytes;
  const rspDelta = signedHexDelta(
    snapshot.registers.rsp,
    previousSnapshot?.registers.rsp,
  );
  const rbpDelta = signedHexDelta(
    snapshot.registers.rbp,
    previousSnapshot?.registers.rbp,
  );

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info">measured, not simulated</StatusBadge>
        <span className="font-mono text-[10px] text-slate-600">
          snapshot #{snapshot.snapshot_id} · {snapshot.stop_reason ?? "stopped"}
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <section className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
            instruction
          </h3>
          {instruction ? (
            <>
              <div className="mt-1 font-mono text-[12px] text-cyan-200">
                {instruction.address} · {instruction.text}
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-600">
                bytes {instruction.bytes ?? "unavailable"} · mnemonic{" "}
                {instruction.mnemonic ?? "unknown"} · operands{" "}
                {instruction.operands ?? "none"}
              </div>
              {selected ? (
                <div className="mt-3 border-t border-[#1e2635] pt-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                    selected line (not necessarily current RIP)
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-300">
                    {selected.address} · {selected.text}
                  </div>
                </div>
              ) : null}
              <p className="mt-3 text-[10px] leading-5 text-slate-500">
                The next execution effect is not guessed here. Step once and compare the
                measured register/byte changes shown below.
              </p>
            </>
          ) : (
            <p className="mt-1 font-mono text-[10px] text-rose-300/80">
              GDB did not provide an instruction for this snapshot.
            </p>
          )}
        </section>

        <section className="rounded border border-[#1e2635] bg-[#0d1117] p-3">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
            measured effects since previous snapshot
          </h3>
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-slate-400">
            <li>
              registers changed:{" "}
              <span className="text-slate-200">
                {changedRegisters.length ? changedRegisters.join(", ") : "none"}
              </span>
            </li>
            <li>
              bytes changed: <span className="text-slate-200">{changedBytes.length}</span>
            </li>
            <li>
              RSP delta: <span className="text-orange-300">{rspDelta ?? "n/a"}</span>
            </li>
            <li>
              RBP delta: <span className="text-sky-300">{rbpDelta ?? "n/a"}</span>
            </li>
            <li>
              stack window:{" "}
              <span className="text-slate-200">
                {snapshot.stack.range_start ?? "?"} .. {snapshot.stack.range_end ?? "?"}
              </span>
            </li>
          </ul>
          {snapshot.stack.unreadable_ranges.length > 0 ? (
            <p className="mt-2 font-mono text-[10px] text-rose-300/80">
              {snapshot.stack.unreadable_ranges.length} unreadable range(s); bytes are unknown,
              not zero.
            </p>
          ) : null}
          {snapshot.warnings.length > 0 ? (
            <div className="mt-3 border-t border-[#1e2635] pt-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-amber-300/80">
                warnings
              </div>
              <ul className="mt-1 space-y-1 font-mono text-[10px] text-amber-200/80">
                {snapshot.warnings.slice(0, 6).map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
