import { useTranslation } from "react-i18next";

import { parseAddress } from "../../lib/address";
import type { MemoryChange } from "../../types/debug";

interface MemoryChangeOverlayProps {
  /**
   * The exact byte-level diff for this block (from snapshot.diff). Each entry
   * is rendered as a precise marker at its real byte position — the block is
   * never covered wholesale.
   */
  changes: MemoryChange[];
  /** Exclusive end address of the block (top edge of the drawing). */
  blockEnd: string;
  /** Current px/byte scale, so marks land on the exact byte row. */
  pxPerByte: number;
  animationsEnabled: boolean;
  reducedMotion: boolean;
}

/**
 * Byte-accurate change markers for a real memory block.
 *
 * Every changed byte gets a small marker on the left edge at its own row plus
 * a faint full-width tick on that byte row only; the tooltip carries the exact
 * `before → after` evidence straight from snapshot.diff. Nothing here covers
 * or resizes the block.
 */
export function MemoryChangeOverlay({
  changes,
  blockEnd,
  pxPerByte,
  animationsEnabled,
  reducedMotion,
}: MemoryChangeOverlayProps) {
  const { t } = useTranslation(["panels"]);
  if (changes.length === 0) return null;
  const blockEndBig = parseAddress(blockEnd);
  if (blockEndBig === null) return null;
  const animate = animationsEnabled && !reducedMotion;

  const marks = changes
    .map((change) => {
      const address = parseAddress(change.address);
      if (address === null) return null;
      // Top of the changed byte's row, relative to the block's top edge.
      const top = Number(blockEndBig - (address + 1n)) * pxPerByte;
      if (top < 0) return null;
      return { change, top };
    })
    .filter((mark): mark is { change: MemoryChange; top: number } => mark !== null)
    .sort((left, right) => left.top - right.top);

  if (marks.length === 0) return null;

  return (
    <span
      aria-hidden="true"
      data-testid="stack-map-changed-overlay"
      data-animated={animate ? "true" : "false"}
      data-count={marks.length}
      title={t("panels:stackMap.changedCount", { count: marks.length })}
      className="pointer-events-none absolute inset-0"
    >
      {marks.map(({ change, top }) => (
        <span key={change.address}>
          <span
            className={`absolute left-0 w-[5px] bg-emerald-300 ${
              animate ? "memory-change-flash" : ""
            }`}
            style={{ top, height: Math.max(2, pxPerByte) }}
          />
          <span
            className="absolute left-[5px] right-0 h-[2px] bg-emerald-300/45"
            style={{ top: top + Math.max(1, pxPerByte / 2) - 1 }}
          />
          <span
            className="absolute left-[8px] hidden"
            data-testid="stack-map-changed-evidence"
          >
            {change.address}: {change.before ?? "??"} → {change.after ?? "??"}
          </span>
        </span>
      ))}
    </span>
  );
}
