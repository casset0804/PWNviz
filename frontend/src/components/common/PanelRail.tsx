interface PanelRailProps {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
}

export function PanelRail({ label, side, onExpand }: PanelRailProps) {
  return (
    <div
      className={`flex min-h-0 flex-col items-center gap-3 border-[#1a2431] bg-[#0a0f15] py-2 max-lg:h-8 max-lg:flex-row max-lg:gap-2 max-lg:border-b max-lg:px-2 max-lg:py-0 ${
        side === "left" ? "border-r" : "border-l"
      }`}
      aria-label={`${label} collapsed`}
      data-testid={`panel-rail-${side}`}
    >
      <button
        type="button"
        onClick={onExpand}
        title={`Expand ${label}`}
        aria-label={`Expand ${label}`}
        className="grid h-6 w-6 place-items-center border border-[#202c3b] bg-[#0d141d] font-mono text-[12px] leading-none text-[#7f91a5] transition-colors hover:border-[#3a4b60] hover:text-[#d2deea]"
      >
        {side === "left" ? "›" : "‹"}
      </button>
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#536378] [writing-mode:vertical-rl] max-lg:[writing-mode:horizontal-tb]">
        {label}
      </span>
    </div>
  );
}
