/**
 * Fixed-row windowing for the stack canvas.
 *
 * Every stack row is exactly `ROW_HEIGHT` pixels tall, so a simple arithmetic
 * window is enough and no measurement library is required. Virtualisation only
 * engages above `VIRTUALIZATION_THRESHOLD` rows (the default RSP window is 64
 * rows), which keeps the common teaching view a plain, fully accessible list and
 * preserves the existing DOM-based centering behaviour.
 *
 * Evaluated TanStack Virtual and intentionally did not take the dependency:
 * the rows are fixed-height, the canvas already owns its scroll container, and
 * dynamic measurement is exactly what must *not* happen here (it would shift
 * rows under the user's cursor while stepping).
 */
export const ROW_HEIGHT_PX = 22;
export const VIRTUALIZATION_THRESHOLD = 200;
export const VIRTUAL_OVERSCAN = 8;

export interface VirtualWindow {
  enabled: boolean;
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export function computeVirtualWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  options: {
    threshold?: number;
    rowHeight?: number;
    overscan?: number;
  } = {},
): VirtualWindow {
  const threshold = options.threshold ?? VIRTUALIZATION_THRESHOLD;
  const rowHeight = options.rowHeight ?? ROW_HEIGHT_PX;
  const overscan = options.overscan ?? VIRTUAL_OVERSCAN;

  if (rowCount <= threshold) {
    return {
      enabled: false,
      start: 0,
      end: rowCount,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const safeScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const safeHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const firstVisible = Math.min(
    rowCount,
    Math.max(0, Math.floor(safeScrollTop / rowHeight)),
  );
  const visibleCount = Math.ceil(safeHeight / rowHeight);
  const start = Math.max(0, Math.min(rowCount, firstVisible - overscan));
  const end = Math.min(
    rowCount,
    Math.max(start, firstVisible + visibleCount + overscan),
  );

  return {
    enabled: true,
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (rowCount - end) * rowHeight),
  };
}
