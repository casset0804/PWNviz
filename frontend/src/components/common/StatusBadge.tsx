import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "error" | "idle" | "info";

const TONE_STYLES: Record<Tone, { box: string; glyph: string }> = {
  ok: {
    box: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    glyph: "OK",
  },
  warn: {
    box: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    glyph: "!",
  },
  error: {
    box: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    glyph: "X",
  },
  idle: {
    box: "border-slate-600/50 bg-slate-700/20 text-slate-400",
    glyph: "-",
  },
  info: {
    box: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
    glyph: "i",
  },
};

interface StatusBadgeProps {
  tone: Tone;
  children: ReactNode;
  className?: string;
}

/**
 * Status chip that always carries a textual glyph next to its label, so state is
 * never communicated by colour alone.
 */
export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${style.box} ${className ?? ""}`}
    >
      <span aria-hidden="true" className="font-bold">
        {style.glyph}
      </span>
      <span>{children}</span>
    </span>
  );
}
