/**
 * React Profiler instrumentation for the memory canvas.
 *
 * The wrapper only appends numbers to a bounded ring buffer: no state updates,
 * no timers, no allocation per render beyond a few primitives. The E2E/UI perf
 * harness reads the same data through `window.__PWNVIZ_RENDER_PERF__`.
 */
export interface StackRenderStats {
  commits: number;
  totalMs: number;
  lastMs: number;
  meanMs: number;
  maxMs: number;
  samples: number[];
}

const MAX_SAMPLES = 240;

const stackStats: StackRenderStats = {
  commits: 0,
  totalMs: 0,
  lastMs: 0,
  meanMs: 0,
  maxMs: 0,
  samples: [],
};

const renderPerf = {
  stack: stackStats,
  updates: 0,
  snapshots: 0,
  reset: resetRenderPerf,
};

function publish(): void {
  if (typeof window !== "undefined") {
    window.__PWNVIZ_RENDER_PERF__ = renderPerf;
  }
}

/** Called from <Profiler onRender> for the StackMemoryView subtree only. */
export function recordStackRender(
  _id: string,
  _phase: "mount" | "update" | "nested-update",
  actualDuration: number,
): void {
  stackStats.commits += 1;
  stackStats.lastMs = actualDuration;
  stackStats.totalMs += actualDuration;
  stackStats.samples.push(actualDuration);
  if (stackStats.samples.length > MAX_SAMPLES) {
    stackStats.samples.shift();
  }
  stackStats.meanMs = stackStats.totalMs / stackStats.commits;
  stackStats.maxMs = Math.max(stackStats.maxMs, actualDuration);
  publish();
}

export function countSnapshotUpdate(): void {
  renderPerf.snapshots += 1;
  renderPerf.updates += 1;
  publish();
}

export function resetRenderPerf(): void {
  stackStats.commits = 0;
  stackStats.totalMs = 0;
  stackStats.lastMs = 0;
  stackStats.meanMs = 0;
  stackStats.maxMs = 0;
  stackStats.samples = [];
  renderPerf.updates = 0;
  renderPerf.snapshots = 0;
  publish();
}

export function getStackRenderStats(): StackRenderStats {
  return { ...stackStats, samples: [...stackStats.samples] };
}

publish();
