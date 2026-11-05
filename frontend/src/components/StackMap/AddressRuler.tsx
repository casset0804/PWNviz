import { useTranslation } from "react-i18next";

import { STACK_MAP_RULER_WIDTH } from "../../lib/stackMap";

interface AddressRulerProps {
  ticks: Array<{ address: string; top: number; major: boolean }>;
  height: number;
}

/**
 * Real address ruler. Labels are placed at the same Y coordinate as the byte
 * rows, so a block's top edge and its address label are always aligned.
 */
export function AddressRuler({ ticks, height }: AddressRulerProps) {
  const { t } = useTranslation(["panels"]);
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-10 select-none border-r border-[#1d2b3b]"
      style={{ width: STACK_MAP_RULER_WIDTH, height }}
      aria-hidden="true"
      data-testid="stack-map-ruler"
    >
      <div className="absolute inset-0 bg-[#080e15]" />
      <span className="absolute right-2 top-0 font-mono text-[12px] uppercase tracking-[0.14em] text-[#43556a]">
        {t("panels:stackMap.highAddress")}
      </span>
      <span className="absolute bottom-1 right-2 font-mono text-[12px] uppercase tracking-[0.14em] text-[#43556a]">
        {t("panels:stackMap.lowAddress")}
      </span>
      {ticks.map((tick) => (
        <div
          key={tick.address}
          className="absolute right-0 flex items-center justify-end gap-2"
          style={{ top: tick.top, transform: "translateY(-50%)" }}
        >
          {tick.major ? (
            <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-[#7f92a8]">
              {tick.address}
            </span>
          ) : null}
          <span
            className={`block bg-[#2b3d51] ${
              tick.major ? "h-px w-3" : "h-px w-1.5 opacity-60"
            }`}
          />
        </div>
      ))}
    </div>
  );
}
