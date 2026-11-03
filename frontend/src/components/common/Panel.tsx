import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, hint, actions, children, className }: PanelProps) {
  return (
    <section
      className={`flex min-h-0 flex-col bg-[#0d1117] ${className ?? ""}`}
      aria-label={title}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#1e2635] px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {title}
          </h2>
          {hint ? (
            <span className="text-[10px] text-slate-600">{hint}</span>
          ) : null}
        </div>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
