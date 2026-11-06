import { useTranslation } from "react-i18next";

import { STACK_MAP_RULER_WIDTH } from "../../lib/stackMap";

interface AddressRulerProps {
  ticks: Array<{ address: string; top: number; major: boolean }>;
  height: number;
}

/**
 * Real address ruler, left-aligned (V1.4).
 *
 * Labels sit at the same Y coordinate as the byte rows (one shared
 * addressTop() transform), so an address always reads at its own memory row.
 * Presentation density keeps a handful of majors; no hairline forests.
 */
export function AddressRuler({ ticks, height }: AddressRulerProps) {
  const { t } = useTranslation(["panels"]);
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-10 select-none"
      style={{ width: STACK_MAP_RULER_WIDTH, height }}
      aria-hidden="true"
      data-testid="stack-map-ruler"
    >
      <span className="absolute left-2 top-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[#43556a]">
        {t("panels:stackMap.highAddress")}
      </span>
      <span className="absolute bottom-1 left-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#43556a]">
        {t("panels:stackMap.lowAddress")}
      </span>
      {ticks.map((tick) => (
        <div
          key={tick.address}
          className="absolute left-0 flex w-full items-center gap-1.5"
          style={{ top: tick.top, transform: "translateY(-50%)" }}
        >
          <span className="whitespace-nowrap pl-2 font-mono text-[12.5px] tabular-nums text-[#7f92a8]">
            {tick.address}
          </span>
          <span className="h-px flex-1 bg-[#1d2b3b]" />
        </div>
      ))}
    </div>
  );
}
