import { useTranslation } from "react-i18next";

import {
  STACK_MAP_FRAME_LABEL_WIDTH,
  STACK_MAP_RULER_WIDTH,
} from "../../lib/stackMap";

interface StackPointerMarkerProps {
  kind: "RSP" | "RBP";
  address: string;
  top: number;
  changed: boolean;
  reducedMotion: boolean;
  onFocus: (address: string) => void;
}

/**
 * Exact-address marker. The chip lives in the frame-label gutter; the hairline
 * spans only the memory area, and both are positioned from the same top value
 * as the byte blocks (no offset fudging).
 */
export function StackPointerMarker({
  kind,
  address,
  top,
  changed,
  reducedMotion,
  onFocus,
}: StackPointerMarkerProps) {
  const { t } = useTranslation(["panels"]);
  const orange = kind === "RSP";
  const color = orange ? "#f6ad55" : "#7db8e8";
  const tone = orange
    ? "border-[#f6ad55]/70 bg-[#2a1d0e]/95 text-[#ffd79b]"
    : "border-[#7db8e8]/70 bg-[#101f2d]/95 text-[#b9d9f2]";

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-30"
      style={{
        top,
        transition: reducedMotion ? undefined : "top 220ms ease-out",
      }}
      data-testid={orange ? "stack-map-rsp" : "stack-map-rbp"}
      data-address={address}
      data-changed={changed ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => onFocus(address)}
        title={t(orange ? "panels:stackMap.focusRsp" : "panels:stackMap.focusRbp")}
        className={`pointer-events-auto absolute flex h-[44px] -translate-y-1/2 flex-col justify-center rounded border border-l-[3px] px-2 font-mono shadow-[0_2px_12px_rgba(0,0,0,0.45)] transition-colors hover:brightness-110 ${tone} ${
          changed ? "stack-marker-changed" : ""
        }`}
        style={{ left: 6, width: STACK_MAP_RULER_WIDTH - 12 }}
      >
        <span className="text-[14px] font-bold leading-4 tracking-[0.08em]">{kind}</span>
        <span className="truncate text-[11.5px] tabular-nums leading-4 opacity-90">
          {address}
        </span>
      </button>
      {/* Thin connector through the frame-label gutter, then the exact line
          across the memory blocks. */}
      <div
        className="absolute h-px -translate-y-1/2 opacity-40"
        style={{
          left: STACK_MAP_RULER_WIDTH - 4,
          width: STACK_MAP_FRAME_LABEL_WIDTH + 4,
          background: color,
        }}
        aria-hidden="true"
      />
      <div
        className="absolute h-[2px] -translate-y-1/2"
        style={{
          left: STACK_MAP_RULER_WIDTH + STACK_MAP_FRAME_LABEL_WIDTH,
          right: 0,
          background: `linear-gradient(90deg, ${color} 0%, ${color} 78%, transparent 100%)`,
          boxShadow: `0 0 8px ${color}55`,
        }}
        aria-hidden="true"
      >
        <span
          className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}
