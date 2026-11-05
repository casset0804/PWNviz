import { useTranslation } from "react-i18next";

import type { PointerLink } from "../../lib/stackMap";

interface PointerArrowProps {
  link: PointerLink;
  /** Dense orthogonal lane (0..n-1); every drawn arrow owns a distinct X. */
  laneIndex: number;
  /** Pixels per lane slot — the routing area grows with the visible count. */
  laneWidth: number;
  /** Absolute Y of the pointer block's (staggered) exit anchor. */
  fromTop: number;
  /** Absolute Y of the target's (staggered) entry anchor. */
  toTop: number;
  /** X where blocks end (the pointer lane starts). */
  blockRight: number;
  /** Right edge of the routing lane. */
  laneRight: number;
  highlighted: boolean;
  /** True when some other arrow is hovered: this one fades instead. */
  dimmed: boolean;
  reducedMotion: boolean;
  onSelect: () => void;
  onHover: (linkId: string | null) => void;
}

/**
 * Orthogonal connector for one pointer.
 *
 * Route: leave the block horizontally, turn into the arrow's OWN lane X, run
 * vertically to the target row, turn back into the target. Rounded corners,
 * one lane per arrow — no two arrows ever share a control point, so the map
 * stays readable even with a dozen pointers. A line is only produced when the
 * pointer value and the target address are exactly equal (resolved) or when
 * the target address is inside the visible stack window (unresolved, dashed).
 */
export function PointerArrow({
  link,
  laneIndex,
  laneWidth,
  fromTop,
  toTop,
  blockRight,
  laneRight,
  highlighted,
  dimmed,
  reducedMotion,
  onSelect,
  onHover,
}: PointerArrowProps) {
  const { t } = useTranslation(["panels"]);
  const resolved = link.state === "resolved";
  const color = highlighted ? "#6ee7b7" : resolved ? "#7dd3fc" : "#fbbf24";
  // Lane slot centre: dense indices keep arrows side by side, never stacked.
  const laneX = laneRight - (laneIndex + 0.5) * laneWidth;
  const dy = toTop - fromTop;
  const radius = Math.max(
    0,
    Math.min(7, Math.abs(dy) / 2, Math.max(0, laneX - blockRight) / 2),
  );
  const dir = dy >= 0 ? 1 : -1;
  // Orthogonal polyline with rounded corners; a straight line when level.
  const path =
    radius <= 0.5 || Math.abs(laneX - blockRight) < 1
      ? `M ${blockRight} ${fromTop} L ${laneX} ${fromTop} L ${laneX} ${toTop} L ${blockRight} ${toTop}`
      : `M ${blockRight} ${fromTop} `
        + `L ${laneX - radius} ${fromTop} `
        + `Q ${laneX} ${fromTop} ${laneX} ${fromTop + radius * dir} `
        + `L ${laneX} ${toTop - radius * dir} `
        + `Q ${laneX} ${toTop} ${laneX - radius} ${toTop} `
        + `L ${blockRight} ${toTop}`;
  // Stable, unique marker id derived from the link id (never the array index).
  const headId = `pwnviz-head-${link.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${link.id.length.toString(36)}`;
  const label =
    link.targetKind === "unknown"
      ? t("panels:stackMap.pointerUnresolved")
      : link.state === "outside-window"
        ? t("panels:stackMap.pointerOutside")
        : link.state === "null"
          ? t("panels:stackMap.pointerNull")
          : `${link.variableName} → ${link.targetAddress}`;
  const opacity = dimmed ? 0.18 : 1;

  return (
    <g
      data-testid="stack-map-pointer-arrow"
      data-state={link.state}
      data-from={link.fromAddress}
      data-target={link.targetAddress}
      data-lane={laneIndex}
      data-lane-x={laneX}
      opacity={opacity}
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
        strokeWidth={highlighted ? 3 : 2}
        strokeOpacity={highlighted ? 1 : 0.85}
        strokeDasharray={resolved ? undefined : "6 5"}
        markerEnd={`url(#${headId})`}
        style={{ pointerEvents: "none", transition: reducedMotion ? undefined : "stroke-width 160ms ease-out" }}
      />
      {/* Exit anchor dot on the block edge; the entry is the arrow head. */}
      <circle
        cx={blockRight}
        cy={fromTop}
        r={highlighted ? 3.5 : 2.5}
        fill={color}
        fillOpacity={0.9}
        style={{ pointerEvents: "none" }}
      />
      <title>{label}</title>
    </g>
  );
}
