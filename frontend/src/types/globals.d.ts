import type { StoreApi } from "zustand";

/**
 * Test/dev-only globals.
 *
 * `__PWNVIZ_STORE__` is assigned in development builds so the UI performance
 * harness can drive real step actions through the real store; it is never
 * exposed in production bundles and never injects mock data.
 * `__PWNVIZ_RENDER_PERF__` is written by the React Profiler wrapper.
 */
declare global {
  interface Window {
    __PWNVIZ_STORE__?: unknown;
    __PWNVIZ_RENDER_PERF__?: {
      stack?: {
        commits: number;
        totalMs: number;
        lastMs: number;
        meanMs: number;
        maxMs: number;
        samples: number[];
      };
      updates?: number;
      snapshots?: number;
      reset?: () => void;
    };
  }
}

export type DebugStoreApi = StoreApi<unknown>;
