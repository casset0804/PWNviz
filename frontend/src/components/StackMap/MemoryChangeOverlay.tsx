import { useTranslation } from "react-i18next";

interface MemoryChangeOverlayProps {
  /** Changes between two snapshots; the overlay remounts per snapshot id. */
  changedCount: number;
  animationsEnabled: boolean;
  reducedMotion: boolean;
}

/**
 * A short, non-flashing green cue over a real memory block whose bytes changed
 * in the current diff. Static under reduced motion (or when the user disabled
 * animations); it never delays the store update.
 */
export function MemoryChangeOverlay({
  changedCount,
  animationsEnabled,
  reducedMotion,
}: MemoryChangeOverlayProps) {
  const { t } = useTranslation(["panels"]);
  if (changedCount === 0) return null;
  const animate = animationsEnabled && !reducedMotion;
  return (
    <span
      aria-hidden="true"
      data-testid="stack-map-changed-overlay"
      data-animated={animate ? "true" : "false"}
      title={t("panels:stackMap.changedCount", { count: changedCount })}
      className={`pointer-events-none absolute inset-0 ${
        animate ? "memory-change-flash" : "bg-emerald-500/[0.10]"
      }`}
    >
      <span className="absolute left-0 top-0 h-full w-[3px] bg-emerald-300" />
    </span>
  );
}
