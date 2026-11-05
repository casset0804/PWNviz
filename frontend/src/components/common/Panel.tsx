import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface PanelProps {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  onCollapse?: () => void;
}

export function Panel({
  title,
  hint,
  actions,
  children,
  className,
  onCollapse,
}: PanelProps) {
  const { t } = useTranslation("common");
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col bg-[#0b1017] ${className ?? ""}`}
      aria-label={title}
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[#1a2431] bg-[#0a0f15] px-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4b8]">
            {title}
          </h2>
          {hint ? (
            <span className="truncate text-[9px] text-[#5d6d80]">{hint}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              title={t("collapse", { title })}
              aria-label={t("collapse", { title })}
              className="grid h-5 w-5 place-items-center border border-[#202c3b] bg-[#0d141d] font-mono text-[11px] leading-none text-[#6f8094] transition-colors hover:border-[#3a4b60] hover:text-[#c4d2e1]"
            >
              —
            </button>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
