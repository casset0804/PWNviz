import { StatusBadge } from "../common/StatusBadge";

export function MemoryInspector() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <StatusBadge tone="idle">phase 2</StatusBadge>
        <span className="text-[11px] text-slate-500">
          Arbitrary address inspection arrives after the snapshot pipeline.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="font-mono text-[11px] text-slate-500" htmlFor="mem-addr">
          address
        </label>
        <input
          id="mem-addr"
          disabled
          placeholder="0x00007fffffffe000"
          className="w-64 rounded border border-[#263044] bg-[#0a0e14] px-2 py-1 font-mono text-xs text-slate-500 placeholder:text-slate-700"
        />
        <label className="font-mono text-[11px] text-slate-500" htmlFor="mem-len">
          length
        </label>
        <input
          id="mem-len"
          disabled
          placeholder="0x100"
          className="w-24 rounded border border-[#263044] bg-[#0a0e14] px-2 py-1 font-mono text-xs text-slate-500 placeholder:text-slate-700"
        />
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded border border-[#263044] bg-[#111722] px-2 py-1 font-mono text-[11px] text-slate-600"
        >
          read
        </button>
      </div>
      <p className="max-w-2xl text-[11px] leading-5 text-slate-500">
        The inspector will call{" "}
        <span className="font-mono text-slate-400">-data-read-memory-bytes</span> on
        the live inferior. Unreadable regions are reported as such instead of being
        guessed or zero-filled.
      </p>
    </div>
  );
}
