import { useTranslation } from "react-i18next";

import type { PointerLink } from "../../lib/stackMap";

interface PointerArrowProps {
  link: PointerLink;
  index: number;
  /** Absolute Y of the pointer block's centre. */
  fromTop: number;
  /** Absolute Y of the target (or of the real target byte when unresolved). */
  toTop: number;
  /** X where blocks end (the pointer lane starts). */
  blockRight: number;
  /** Right edge of the routing lane. */
  laneRight: number;
  highlighted: boolean;
  reducedMotion: boolean;
  onSelect: () => void;
  onHover: (linkId: string | null) => void;
}

/**
 * SVG connector for one pointer.
 *
 * A line is only produced when the pointer value and the target address are
 * exactly equal (resolved) or when the target address is inside the visible
 * stack window (unresolved, dashed). No similarity-based matching happens here.
 */
export function PointerArrow({
  link,
  index,
  fromTop,
  toTop,
  blockRight,
  laneRight,
  highlighted,
  reducedMotion,
  onSelect,
  onHover,
}: PointerArrowProps) {
  const { t } = useTranslation(["panels"]);
  const resolved = link.state === "resolved";
  const color = highlighted
    ? "#6ee7b7"
    : resolved
      ? "#7dd3fc"
      : "#fbbf24";
  const laneX = laneRight - link.laneIndex * 12;
  const control = Math.max(blockRight + 18, laneX);
  const path = `M ${blockRight} ${fromTop} C ${control} ${fromTop}, ${control} ${toTop}, ${blockRight} ${toTop}`;
  const headId = `pwnviz-pointer-head-${index}`;
  const label =
    link.targetKind === "unknown"
      ? t("panels:stackMap.pointerUnresolved")
      : link.state === "outside-window"
        ? t("panels:stackMap.pointerOutside")
        : link.state === "null"
          ? t("panels:stackMap.pointerNull")
          : `${link.variableName} → ${link.targetAddress}`;

  return (
    <g
      data-testid="stack-map-pointer-arrow"
      data-state={link.state}
      data-from={link.fromAddress}
      data-target={link.targetAddress}
    >
      <defs>
        <marker
          id={headId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      {/* Wide invisible stroke gives the connector a comfortable hit target. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onClick={onSelect}
        onMouseEnter={() => onHover(link.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(link.id)}
        onBlur={() => onHover(null)}
        tabIndex={0}
        role="button"
        aria-label={label}
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={highlighted ? 3.5 : 2}
        strokeOpacity={highlighted ? 1 : 0.82}
        strokeDasharray={resolved ? undefined : "6 5"}
        markerEnd={`url(#${headId})`}
        style={{ pointerEvents: "none", transition: reducedMotion ? undefined : "stroke-width 160ms ease-out" }}
      />
      <circle
        cx={blockRight}
        cy={fromTop}
        r={highlighted ? 4 : 3}
        fill={color}
        fillOpacity={0.9}
        style={{ pointerEvents: "none" }}
      />
      <circle
        cx={blockRight}
        cy={toTop}
        r={highlighted ? 5 : 3.5}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        style={{ pointerEvents: "none" }}
      />
      <title>{label}</title>
    </g>
  );
}
