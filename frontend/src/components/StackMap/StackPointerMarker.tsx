import { useTranslation } from "react-i18next";

import {
  STACK_MAP_MARKER_GUTTER,
  STACK_MAP_SPINE_LEFT,
  STACK_MAP_SPINE_WIDTH,
} from "../../lib/stackMap";

interface StackPointerMarkerProps {
  kind: "RSP" | "RBP";
  address: string;
  top: number;
  changed: boolean;
  reducedMotion: boolean;
  onFocus: (address: string) => void;
  /** presentation = chip + short arrow; developer adds a spine-wide guide. */
  variant: "presentation" | "developer";
  /** Vertical nudge for the chip only (RSP === RBP leaf functions). */
  chipOffsetY?: number;
  /** True while the temporary spine-wide guide is shown. */
  guideVisible: boolean;
  onToggleGuide: () => void;
}

/**
 * Right-hand locator for one register (V1.4).
 *
 * The chip lives in the marker gutter to the RIGHT of the memory spine; a
 * short arrow points LEFT at the exact address row on the spine. No line ever
 * crosses the memory column by default — the developer variant (or an explicit
 * click) may show a spine-wide guide, which still stops at the spine edges.
 * The chip may shift vertically when RSP === RBP, but the arrow anchor stays
 * pinned to the real address row.
 */
export function StackPointerMarker({
  kind,
  address,
  top,
  changed,
  reducedMotion,
  onFocus,
  variant,
  chipOffsetY = 0,
  guideVisible,
  onToggleGuide,
}: StackPointerMarkerProps) {
  const { t } = useTranslation(["panels"]);
  const orange = kind === "RSP";
  const color = orange ? "#f6ad55" : "#7db8e8";
  const tone = orange
    ? "border-[#f6ad55]/70 bg-[#2a1d0e] text-[#ffd79b]"
    : "border-[#7db8e8]/70 bg-[#101f2d] text-[#b9d9f2]";
  const showFullGuide = variant === "developer" || guideVisible;
  // Chip occupies most of the marker gutter; a 14 px arrow bridge reaches the
  // spine's right edge, where the anchor dot marks the exact address row.
  const chipLeft = STACK_MAP_SPINE_LEFT + STACK_MAP_SPINE_WIDTH + 14;
  const chipWidth = STACK_MAP_MARKER_GUTTER - 18;

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
      data-variant={variant}
      data-guide={showFullGuide ? "true" : "false"}
    >
      {/* Arrow bridge: from the chip's left edge to the spine's right edge. */}
      <div
        aria-hidden="true"
        className="absolute h-[2px] -translate-y-1/2"
        style={{
          left: STACK_MAP_SPINE_LEFT + STACK_MAP_SPINE_WIDTH,
          width: 14,
          background: color,
        }}
      >
        <span
          className="absolute -left-[5px] top-1/2 h-2 w-2 -translate-y-1/2 rotate-45"
          style={{ background: color }}
        />
      </div>

      <button
        type="button"
        onClick={() => {
          onFocus(address);
          onToggleGuide();
        }}
        title={t(orange ? "panels:stackMap.focusRsp" : "panels:stackMap.focusRbp")}
        className={`pointer-events-auto absolute flex h-[44px] -translate-y-1/2 flex-col justify-center rounded border px-2 font-mono shadow-[0_1px_6px_rgba(0,0,0,0.4)] transition-colors hover:brightness-110 ${tone} ${
          changed ? "stack-marker-changed" : ""
        }`}
        style={{ left: chipLeft, width: chipWidth, top: chipOffsetY }}
      >
        <span className="text-[15px] font-bold leading-4 tracking-[0.08em]">{kind}</span>
        <span className="truncate text-[11px] tabular-nums leading-4 opacity-90">
          {address}
        </span>
      </button>

      {showFullGuide ? (
        <div
          aria-hidden="true"
          className="absolute h-[2px] -translate-y-1/2"
          style={{
            left: STACK_MAP_SPINE_LEFT,
            width: STACK_MAP_SPINE_WIDTH,
            background: `linear-gradient(90deg, transparent 0%, ${color} 12%, ${color} 88%, transparent 100%)`,
          }}
          data-testid={orange ? "stack-map-rsp-guide" : "stack-map-rbp-guide"}
        />
      ) : null}
    </div>
  );
}
