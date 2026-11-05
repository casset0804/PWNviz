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
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[#1a2431] bg-[#0a0f15] px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="shrink-0 text-[18px] font-semibold tracking-[0.01em] text-[#c3d4e5]">
            {title}
          </h2>
          {hint ? (
            <span className="truncate text-[12.5px] text-[#75899e]">{hint}</span>
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
              className="grid h-7 w-7 place-items-center rounded-sm border border-[#202c3b] bg-[#0d141d] font-mono text-[15px] leading-none text-[#8397ab] transition-colors hover:border-[#3a4b60] hover:text-[#c4d2e1]"
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
