import { useTranslation } from "react-i18next";

import {
  groupMemoryChangesByAddress,
  layoutChangeGroups,
  type MemoryChangeGroup,
} from "../../lib/stackMap";
import type { MemoryChange } from "../../types/debug";

interface MemoryChangeOverlayProps {
  /**
   * The exact byte-level diff for this block (from snapshot.diff). Contiguous
   * bytes merge into one left-edge run; the data itself is never altered.
   */
  changes: MemoryChange[];
  /** Exclusive end address of the block (top edge of the drawing). */
  blockEnd: string;
  /** Current px/byte scale, so marks land on the exact byte rows. */
  pxPerByte: number;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  /** Open the Inspector on the clicked change run (before/after table). */
  onSelectChangeGroup?: (group: MemoryChangeGroup) => void;
}

/**
 * Byte-accurate change markers for a real memory block.
 *
 * V1.3.2: no horizontal lines at all. Contiguous changed bytes merge into ONE
 * narrow vertical run pinned to the block's left edge (4 px wide, exactly as
 * tall as the real byte run); the tooltip and the click-through Inspector
 * carry the per-byte `before → after` evidence straight from snapshot.diff.
 * Nothing here covers, resizes or crosses the block.
 */
export function MemoryChangeOverlay({
  changes,
  blockEnd,
  pxPerByte,
  animationsEnabled,
  reducedMotion,
  onSelectChangeGroup,
}: MemoryChangeOverlayProps) {
  const { t } = useTranslation(["panels"]);
  if (changes.length === 0) return null;
  const animate = animationsEnabled && !reducedMotion;
  const layouts = layoutChangeGroups(groupMemoryChangesByAddress(changes), blockEnd, pxPerByte);
  if (layouts.length === 0) return null;

  return (
    <span
      aria-hidden="false"
      data-testid="stack-map-changed-overlay"
      data-animated={animate ? "true" : "false"}
      data-count={changes.length}
      data-runs={layouts.length}
      className="pointer-events-none absolute inset-0 z-10"
    >
      {layouts.map(({ group, top, height }) => (
        <button
          key={group.start}
          type="button"
          data-testid="stack-map-change-mark"
          data-start={group.start}
          data-end={group.end}
          data-count={group.count}
          data-width={4}
          title={`${group.start} – ${group.end} · ${t("panels:stackMap.changedCount", {
            count: group.count,
          })}\n${group.changes
            .map((change) => `${change.address}: ${change.before ?? "??"} → ${change.after ?? "??"}`)
            .join("\n")}`}
          aria-label={`${group.start} – ${group.end}, ${group.count} changed bytes`}
          onClick={(event) => {
            event.stopPropagation();
            onSelectChangeGroup?.(group);
          }}
          className={`pointer-events-auto absolute left-0 w-[4px] cursor-pointer rounded-[1px] bg-emerald-600/55 transition-colors hover:bg-emerald-400/90 ${
            animate ? "memory-change-flash" : ""
          }`}
          style={{ top, height }}
        />
      ))}
    </span>
  );
}
