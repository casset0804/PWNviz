import { defineConfig } from "@playwright/test";

/**
 * Visual regression suite for the presentation workbench.
 *
 * These tests drive a REAL backend (GDB/MI3 inside WSL) and a real Vite dev
 * server; memory contents always come from live snapshots — mock data is not
 * allowed for this suite. Start both with scripts/run_visual_tests.sh.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PWNVIZ_APP_URL ?? "http://127.0.0.1:5173",
    viewport: { width: 1920, height: 1080 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "off",
  },
});
