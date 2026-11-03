import { useDebugStore } from "../../stores/debugStore";
import { StatusBadge } from "../common/StatusBadge";

export function DiffPanel() {
  const snapshot = useDebugStore((state) => state.snapshot);
  const previousSnapshot = useDebugStore((state) => state.previousSnapshot);
  const history = useDebugStore((state) => state.history);
  const selectByte = useDebugStore((state) => state.selectByte);

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col gap-2 p-4">
        <StatusBadge tone="idle">no snapshot</StatusBadge>
        <p className="text-[11px] text-slate-500">
          Step the real process and the byte-level diff will appear here.
        </p>
      </div>
    );
  }

  const diff = snapshot.diff;
  const previous =
    (diff.previous_snapshot_id !== null
      ? history.find((item) => item.snapshot_id === diff.previous_snapshot_id)
      : null) ??
    previousSnapshot;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={diff.previous_snapshot_id === null ? "idle" : "ok"}>
          {diff.previous_snapshot_id === null
            ? "first snapshot — no diff"
            : `previous snapshot #${diff.previous_snapshot_id}`}
        </StatusBadge>
        <StatusBadge tone={diff.changed_registers.length ? "warn" : "idle"}>
          {diff.changed_registers.length} register(s) changed
        </StatusBadge>
        <StatusBadge tone={diff.changed_bytes.length ? "warn" : "idle"}>
          {diff.changed_bytes.length} byte(s) changed
        </StatusBadge>
        {diff.window_changed ? (
          <StatusBadge tone="info">stack window moved</StatusBadge>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded border border-[#1e2635] bg-[#0d1117]">
          <h3 className="border-b border-[#1e2635] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            registers · before → after
          </h3>
          {diff.changed_registers.length === 0 ? (
            <p className="p-3 font-mono text-[10px] text-slate-600">
              no register changed between these snapshots
            </p>
          ) : (
            <ul className="divide-y divide-[#161d28]">
              {diff.changed_registers.map((register) => (
                <li
                  key={register}
                  className="flex items-baseline justify-between gap-3 px-3 py-1.5 font-mono text-[11px]"
                >
                  <span className="text-slate-400">{register}</span>
                  <span className="text-right">
                    <span className="text-slate-600">
                      {previous?.registers[register] ?? "?"}
                    </span>
                    <span className="mx-2 text-slate-700">→</span>
                    <span className="text-emerald-200">
                      {snapshot.registers[register] ?? "unreadable"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border border-[#1e2635] bg-[#0d1117]">
          <h3 className="border-b border-[#1e2635] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            changed bytes · absolute address
          </h3>
          {diff.changed_bytes.length === 0 ? (
            <p className="p-3 font-mono text-[10px] text-slate-600">
              no byte in the overlapping stack window changed
            </p>
          ) : (
            <ul className="max-h-48 divide-y divide-[#161d28] overflow-auto">
              {diff.changed_bytes.map((change) => (
                <li key={change.address}>
                  <button
                    type="button"
                    onClick={() => selectByte(change.address)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left font-mono text-[11px] hover:bg-[#131a26]"
                  >
                    <span className="text-slate-400">{change.address}</span>
                    <span>
                      <span className="text-slate-600">{change.before ?? "unknown"}</span>
                      <span className="mx-2 text-slate-700">→</span>
                      <span className="text-emerald-200">
                        {change.after ?? "unreadable"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {snapshot.warnings.length > 0 ? (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-amber-300/80">
            snapshot warnings
          </div>
          <ul className="mt-1 space-y-1 font-mono text-[10px] text-amber-200/80">
            {snapshot.warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
