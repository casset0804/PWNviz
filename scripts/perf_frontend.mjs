#!/usr/bin/env node
/**
 * Frontend rendering performance harness.
 *
 * Drives 100 *real* single-step actions through the running workbench (real
 * backend, real GDB), while the React Profiler wrapper around StackMemoryView
 * records commit counts and render durations. No mock snapshots are injected:
 * the harness calls the same Zustand actions the toolbar buttons call.
 *
 * Prerequisites:
 *   - backend (WSL) on 127.0.0.1:8000 with the sample built
 *   - `npm run dev` on 127.0.0.1:5173 (development build; the store hook is
 *     only exposed in DEV)
 *   - a Chromium/Edge started with --remote-debugging-port
 *
 * Usage:
 *   node scripts/perf_frontend.mjs [--steps 100] [--reset-every 25]
 * Environment:
 *   PWNVIZ_APP_URL, PWNVIZ_API_URL, PWNVIZ_CDP_URL,
 *   PWNVIZ_PERF_OUT (default docs/benchmarks/frontend.json)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const APP_URL = process.env.PWNVIZ_APP_URL ?? "http://127.0.0.1:5173";
const CDP_URL = (process.env.PWNVIZ_CDP_URL ?? "http://127.0.0.1:9223").replace(/\/$/, "");
const OUT_PATH = resolve(process.env.PWNVIZ_PERF_OUT ?? "docs/benchmarks/frontend.json");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const STEPS = Number(arg("steps", "100"));
const RESET_EVERY = Number(arg("reset-every", "25"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("CDP connect timeout")), 10_000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolveOpen();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        rejectOpen(new Error("CDP socket error"));
      }, { once: true });
    });
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.nextId;
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) rejectSend(new Error(`CDP ${method} timeout`));
      }, timeoutMs);
    });
  }

  async evaluate(expression, timeoutMs = 30_000) {
    const result = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      timeoutMs,
    );
    if (result.exceptionDetails) {
      throw new Error(
        `page evaluation failed: ${result.exceptionDetails.text ?? "unknown exception"}`,
      );
    }
    return result.result?.value;
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
  }
}

async function waitFor(client, description, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (last) return last;
    } catch (error) {
      last = `transient: ${error.message}`;
    }
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${description}; last=${JSON.stringify(last)}`);
}

async function listPages() {
  const response = await fetch(`${CDP_URL}/json/list`);
  if (!response.ok) throw new Error(`CDP list failed: ${response.status}`);
  return response.json();
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  if (ordered.length === 1) return ordered[0];
  const position = fraction * (ordered.length - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, ordered.length - 1);
  const weight = position - low;
  return ordered[low] * (1 - weight) + ordered[high] * weight;
}

function summarise(values) {
  if (!values.length) return { count: 0 };
  const ordered = [...values].sort((left, right) => left - right);
  return {
    count: ordered.length,
    min: Number(ordered[0].toFixed(3)),
    p50: Number(percentile(ordered, 0.5).toFixed(3)),
    p95: Number(percentile(ordered, 0.95).toFixed(3)),
    max: Number(ordered[ordered.length - 1].toFixed(3)),
    mean: Number((ordered.reduce((sum, value) => sum + value, 0) / ordered.length).toFixed(3)),
  };
}

async function main() {
  const pages = await listPages();
  const page =
    pages.find((item) => item.type === "page" && item.url.startsWith(APP_URL)) ??
    pages.find(
      (item) =>
        item.type === "page" &&
        !item.url.startsWith("chrome-extension://") &&
        item.url !== "about:blank",
    ) ??
    pages.find((item) => item.type === "page");
  assert(page, "no CDP page target; start Edge with --remote-debugging-port");
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  let sessionId = null;

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.bringToFront");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1680,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", { url: APP_URL });
    await waitFor(client, "workbench", `Boolean(document.querySelector('[data-testid="workbench"]'))`);

    // Deterministic locale for stable labels is not required here, but the
    // store hook must exist (development build only).
    const hooked = await client.evaluate(`Boolean(window.__PWNVIZ_STORE__)`);
    assert(
      hooked,
      "window.__PWNVIZ_STORE__ is missing: run the Vite development server (import.meta.env.DEV)",
    );

    // Start a real session through the same store action the toolbar uses.
    await waitFor(
      client,
      "run enabled",
      `(() => { const b = document.querySelector('[data-testid="run-session"]'); return Boolean(b) && !b.disabled; })()`,
      60_000,
    );
    await client.evaluate(`window.__PWNVIZ_STORE__.getState().startSession()`);
    await waitFor(
      client,
      "first snapshot",
      `Boolean(window.__PWNVIZ_STORE__.getState().snapshot)`,
      90_000,
    );
    sessionId = await client.evaluate(
      `window.__PWNVIZ_STORE__.getState().session?.session_id ?? null`,
    );
    assert(sessionId, "no session id after startSession");

    // Select a stack byte so selection persistence can be checked after steps.
    await waitFor(
      client,
      "stack byte cell",
      `Boolean(document.querySelector('[data-testid="stack-row"] [data-testid="byte-cell"]'))`,
      30_000,
    );
    const selectedAddress = await client.evaluate(`(() => {
      const cell = document.querySelector('[data-testid="stack-row"] [data-testid="byte-cell"]');
      cell?.click();
      return cell?.getAttribute('data-address') ?? null;
    })()`);
    assert(selectedAddress, "could not select a stack byte");

    const result = await client.evaluate(
      `(async () => {
        const steps = ${STEPS};
        const resetEvery = ${RESET_EVERY};
        const store = () => window.__PWNVIZ_STORE__.getState();
        const perf = window.__PWNVIZ_RENDER_PERF__;
        perf?.reset?.();

        const waitSnapshotAfter = async (previousId, timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const id = store().snapshot?.snapshot_id ?? 0;
            if (id > previousId) return id;
            await new Promise((done) => setTimeout(done, 10));
          }
          return -1;
        };

        const rowNodes = () =>
          new Map(
            [...document.querySelectorAll('[data-testid="stack-row"]')].map((row) => [
              row.getAttribute('data-row-address'),
              row,
            ]),
          );

        const stepTimes = [];
        const miCounts = [];
        let snapshots = 0;
        let restarts = 0;
        let failures = 0;
        let reuseCompared = 0;
        let reuseKept = 0;
        let selectionKept = null;
        const address = ${JSON.stringify(selectedAddress)};
        let attempts = 0;
        while (snapshots < steps && attempts < steps * 4) {
          attempts += 1;
          const index = snapshots + restarts;
          if (snapshots > 0 && index % resetEvery === 0) {
            await store().restartSession();
            restarts += 1;
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline && !store().snapshot) {
              await new Promise((done) => setTimeout(done, 25));
            }
            continue;
          }
          const before = rowNodes();
          const previousId = store().snapshot?.snapshot_id ?? 0;
          const started = performance.now();
          await store().stepInstruction();
          const id = await waitSnapshotAfter(previousId, 30000);
          if (id < 0) {
            failures += 1;
            continue;
          }
          stepTimes.push(performance.now() - started);
          const snapshot = store().snapshot;
          miCounts.push(snapshot?.perf?.mi_command_count ?? 0);
          snapshots += 1;

          // DOM node reuse for rows that are still in the window after the step.
          const after = rowNodes();
          for (const [rowAddress, node] of before) {
            if (!after.has(rowAddress)) continue;
            reuseCompared += 1;
            if (after.get(rowAddress) === node) reuseKept += 1;
          }
          if (selectionKept === null && address) {
            selectionKept =
              document
                .querySelector('[data-testid="byte-cell"][data-address="' + address + '"]')
                ?.getAttribute('data-selected') === 'true';
          }
        }

        const perfData = window.__PWNVIZ_RENDER_PERF__;
        return {
          steps,
          snapshots,
          restarts,
          failures,
          stepTimes,
          miCounts,
          reusedRows: reuseKept,
          comparedRows: reuseCompared,
          selectionKept,
          render: {
            commits: perfData?.stack?.commits ?? 0,
            meanMs: perfData?.stack?.meanMs ?? 0,
            maxMs: perfData?.stack?.maxMs ?? 0,
            samples: [...(perfData?.stack?.samples ?? [])],
          },
        };
      })()`,
      300_000,
    );

    const report = {
      generated_at: new Date().toISOString(),
      protocol: { steps: STEPS, reset_every: RESET_EVERY },
      snapshots: result.snapshots,
      restarts: result.restarts,
      failures: result.failures,
      backend_step_ms: summarise(result.stepTimes),
      backend_mi_commands: summarise(result.miCounts),
      react: {
        commits: result.render.commits,
        commits_per_snapshot:
          result.snapshots > 0
            ? Number((result.render.commits / result.snapshots).toFixed(2))
            : 0,
        stack_render_ms: summarise(result.render.samples),
        profiler_mean_ms: Number((result.render.meanMs ?? 0).toFixed(3)),
        profiler_max_ms: Number((result.render.maxMs ?? 0).toFixed(3)),
      },
      dom: {
        reused_rows: result.reusedRows,
        compared_rows: result.comparedRows,
        reuse_ratio:
          result.comparedRows > 0
            ? Number((result.reusedRows / result.comparedRows).toFixed(3))
            : null,
        selection_kept: result.selectionKept,
      },
    };

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`steps=${report.snapshots} restarts=${report.restarts} failures=${report.failures}`);
    console.log(
      `backend step ms  p50 ${report.backend_step_ms.p50}  p95 ${report.backend_step_ms.p95}  mean ${report.backend_step_ms.mean}`,
    );
    console.log(
      `MI commands/step p50 ${report.backend_mi_commands.p50}  mean ${report.backend_mi_commands.mean}`,
    );
    console.log(
      `React commits    ${report.react.commits} (${report.react.commits_per_snapshot}/snapshot)`,
    );
    console.log(
      `StackMemoryView  p50 ${report.react.stack_render_ms.p50} ms  p95 ${report.react.stack_render_ms.p95} ms  mean ${report.react.stack_render_ms.mean} ms  max ${report.react.stack_render_ms.max} ms`,
    );
    console.log(
      `DOM rows reused  ${report.dom.reused_rows}/${report.dom.compared_rows} (${report.dom.reuse_ratio}); selection kept=${report.dom.selection_kept}`,
    );
    console.log(`report written to ${OUT_PATH}`);
    assert(report.failures === 0, `${report.failures} step(s) did not produce a snapshot`);
  } finally {
    if (sessionId) {
      await client
        .evaluate(`window.__PWNVIZ_STORE__?.getState().terminate()`)
        .catch(() => {});
    }
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
});
