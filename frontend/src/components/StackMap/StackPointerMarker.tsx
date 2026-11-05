import { useTranslation } from "react-i18next";

import { STACK_MAP_FRAME_LABEL_WIDTH, STACK_MAP_RULER_WIDTH } from "../../lib/stackMap";

interface StackPointerMarkerProps {
  kind: "RSP" | "RBP";
  address: string;
  top: number;
  changed: boolean;
  reducedMotion: boolean;
  onFocus: (address: string) => void;
  /** presentation = chip + stub, full guide only on demand; developer = full line. */
  variant: "presentation" | "developer";
  /**
   * Vertical nudge for the chip ONLY (pixels). When RSP and RBP coincide —
   * leaf functions keep RSP at the frame base — the two chips would overlap
   * and block each other's clicks, so they shift apart while both stub and
   * guide stay pinned to the exact address row.
   */
  chipOffsetY?: number;
  /** True while the temporary full-width guide is shown (presentation mode). */
  guideVisible: boolean;
  onToggleGuide: () => void;
}

/**
 * Exact-address marker.
 *
 * The chip lives in the frame-label gutter and is positioned from the same
 * addressTop() transform as the byte blocks. Presentation mode keeps the map
 * clean: only a chip with a short stub arrow — the full-width hairline appears
 * temporarily when the user clicks the marker (or the register card), and the
 * developer variant keeps the permanent reference line.
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
      <button
        type="button"
        onClick={() => {
          onFocus(address);
          onToggleGuide();
        }}
        title={t(orange ? "panels:stackMap.focusRsp" : "panels:stackMap.focusRbp")}
        className={`pointer-events-auto absolute flex h-[44px] -translate-y-1/2 flex-col justify-center rounded border border-l-[3px] px-2 font-mono shadow-[0_1px_6px_rgba(0,0,0,0.4)] transition-colors hover:brightness-110 ${tone} ${
          changed ? "stack-marker-changed" : ""
        }`}
        style={{ left: 6, width: STACK_MAP_RULER_WIDTH - 12, top: chipOffsetY }}
      >
        <span className="text-[14px] font-bold leading-4 tracking-[0.08em]">{kind}</span>
        <span className="truncate text-[11.5px] tabular-nums leading-4 opacity-90">
          {address}
        </span>
      </button>
      {/* Short stub arrow: points at the exact byte row without crossing the
          whole memory area. The full guide is opt-in (or developer mode). */}
      <div
        className="absolute h-px opacity-60"
        style={{
          left: STACK_MAP_RULER_WIDTH - 4,
          width: STACK_MAP_FRAME_LABEL_WIDTH + 10,
          background: `linear-gradient(90deg, ${color} 0%, ${color} 70%, transparent 100%)`,
        }}
        aria-hidden="true"
      />
      {showFullGuide ? (
        <>
          <div
            className="absolute h-px -translate-y-1/2"
            style={{
              left: STACK_MAP_RULER_WIDTH + STACK_MAP_FRAME_LABEL_WIDTH,
              right: 0,
              background: `linear-gradient(90deg, ${color} 0%, ${color} 78%, transparent 100%)`,
            }}
            aria-hidden="true"
            data-testid={orange ? "stack-map-rsp-guide" : "stack-map-rbp-guide"}
          >
            <span
              className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45"
              style={{ background: color }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
