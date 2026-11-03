#!/usr/bin/env node
/**
 * End-to-end UI smoke test against a real PWNviz backend + Vite dev server.
 *
 * It drives a headless Chromium/Edge over CDP, clicks Run and StepI, verifies
 * that the stack canvas/register panel changed from a real snapshot, clicks a
 * changed byte cell, and writes a screenshot.
 *
 * Usage:
 *   node scripts/ui_smoke.mjs
 * Environment:
 *   PWNVIZ_APP_URL   default http://127.0.0.1:5173
 *   PWNVIZ_API_URL   default http://127.0.0.1:8000
 *   PWNVIZ_CDP_URL   default http://127.0.0.1:9223
 *   PWNVIZ_SHOT      output screenshot path
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_URL = process.env.PWNVIZ_APP_URL ?? "http://127.0.0.1:5173";
const API_URL = (process.env.PWNVIZ_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const CDP_URL = (process.env.PWNVIZ_CDP_URL ?? "http://127.0.0.1:9223").replace(/\/$/, "");
const SHOT_PATH = resolve(process.env.PWNVIZ_SHOT ?? "docs/assets/workbench-phase2.png");
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

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) rejectSend(new Error(`CDP ${method} timeout`));
      }, 30_000);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
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
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await client.evaluate(expression);
    if (lastValue) return lastValue;
    await sleep(100);
  }
  const errorBanner = await client
    .evaluate(`document.querySelector('[data-testid="workbench"]')?.textContent?.slice(0, 400) ?? ""`)
    .catch(() => "");
  throw new Error(`timeout waiting for ${description}; last=${JSON.stringify(lastValue)} banner=${errorBanner}`);
}

async function listPages() {
  const response = await fetch(`${CDP_URL}/json/list`);
  if (!response.ok) throw new Error(`CDP list failed: ${response.status}`);
  return response.json();
}

async function main() {
  const pages = await listPages();
  const page = pages.find((item) => item.type === "page");
  assert(page, "no CDP page target; start Edge with --remote-debugging-port");

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  let sessionId = null;
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1680,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", { url: APP_URL });
    await waitFor(client, "workbench render", `Boolean(document.querySelector('[data-testid="workbench"]'))`);

    await waitFor(
      client,
      "Run enabled",
      `(() => {
        const button = document.querySelector('[data-testid="run-session"]');
        return Boolean(button) && !button.disabled;
      })()`,
      45_000,
    );
    await client.evaluate(`document.querySelector('[data-testid="run-session"]').click()`);
    await waitFor(
      client,
      "real snapshot",
      `(() => {
        const value = document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value');
        const state = document.querySelector('[data-testid="debug-state"]')?.textContent ?? '';
        return Boolean(value && value.startsWith('0x')) && state.includes('stopped');
      })()`,
      90_000,
    );

    sessionId = await client.evaluate(`new URLSearchParams(location.search).get('sessionId')`);
    const before = await client.evaluate(`({
      snapshot: document.querySelector('[data-testid="snapshot-id"]')?.textContent ?? '',
      rip: document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value') ?? '',
      rsp: document.querySelector('[data-testid="register-rsp"]')?.getAttribute('data-value') ?? '',
      rbp: document.querySelector('[data-testid="register-rbp"]')?.getAttribute('data-value') ?? '',
      rows: document.querySelectorAll('[data-testid="stack-row"]').length,
      markers: document.querySelectorAll('[data-markers="RSP"],[data-markers="RBP"]').length,
    })`);
    assert(before.rows > 0, "stack canvas has no rows");
    assert(before.markers > 0, "RSP/RBP marker not visible in the stack canvas");
    assert(before.rsp.startsWith("0x") && before.rbp.startsWith("0x"), "RSP/RBP missing");

    await waitFor(
      client,
      "StepI enabled",
      `(() => {
        const button = document.querySelector('[data-testid="step-instruction"]');
        return Boolean(button) && !button.disabled;
      })()`,
      30_000,
    );
    await client.evaluate(`document.querySelector('[data-testid="step-instruction"]').click()`);
    await waitFor(
      client,
      "newer snapshot after StepI",
      `(() => {
        const value = document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value');
        const snapshot = document.querySelector('[data-testid="snapshot-id"]')?.textContent ?? '';
        const state = document.querySelector('[data-testid="debug-state"]')?.textContent ?? '';
        return Boolean(value && value !== ${JSON.stringify(before.rip)}) && state.includes('stopped');
      })()`,
      60_000,
    );

    const after = await client.evaluate(`({
      snapshot: document.querySelector('[data-testid="snapshot-id"]')?.textContent ?? '',
      rip: document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value') ?? '',
      changedCells: document.querySelectorAll('[data-testid="byte-cell"][data-changed="true"]').length,
      changedLabels: Array.from(document.querySelectorAll('[data-testid="stack-row"]'))
        .map((row) => row.textContent)
        .filter((text) => text.includes('changed')),
    })`);
    assert(after.rip !== before.rip, "RIP did not change after StepI");
    assert(after.changedCells > 0, "no changed byte cell highlighted after StepI");

    // The register click must scroll the canvas to the real RSP marker row.
    await client.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="stack-canvas"]');
      const scroller = Array.from(canvas.querySelectorAll('div'))
        .find((node) => node.scrollHeight > node.clientHeight + 40);
      if (scroller) scroller.scrollTop = 0;
    })()`);
    await client.evaluate(`document.querySelector('[data-testid="register-rsp"]').click()`);
    const rspVisible = await waitFor(
      client,
      "RSP row scrolled into view",
      `(() => {
        const cell = document.querySelector('[data-markers="RSP"]');
        const row = cell?.closest('[data-testid="stack-row"]');
        const canvas = document.querySelector('[data-testid="stack-canvas"]');
        if (!row || !canvas) return false;
        const rowBox = row.getBoundingClientRect();
        const canvasBox = canvas.getBoundingClientRect();
        return rowBox.top >= canvasBox.top && rowBox.bottom <= canvasBox.bottom;
      })()`,
      10_000,
    );

    await client.evaluate(
      `document.querySelector('[data-testid="byte-cell"][data-changed="true"]').click()`,
    );
    const inspector = await waitFor(
      client,
      "memory inspector selection",
      `document.querySelector('[data-testid="inspector-address"]')?.textContent ?? ""`,
      10_000,
    );
    assert(inspector.startsWith("0x"), "inspector did not receive selected address");

    // Disassembly selection is allowed and must not create a breakpoint.
    await client.evaluate(
      `document.querySelector('[data-testid="disassembly-line"][data-current="false"]')?.click()`,
    );
    const selectionText = await client.evaluate(
      `document.querySelector('[data-testid="workbench"]')?.textContent ?? ""`,
    );
    assert(selectionText.includes("selected instruction"), "disassembly selection missing");

    await client.evaluate(`document.querySelector('[data-testid="tab-diff"]').click()`);
    await waitFor(
      client,
      "diff panel",
      `document.querySelector('[data-testid="tab-diff"]')?.getAttribute('aria-pressed') === 'true'`,
      10_000,
    );
    await client.evaluate(`document.querySelector('[data-testid="tab-memory"]').click()`);
    await client.evaluate(
      `document.querySelector('[data-testid="byte-cell"][data-changed="true"]').click()`,
    );

    const screenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    writeFileSync(SHOT_PATH, Buffer.from(screenshot.data, "base64"));

    // Terminate through the UI and verify the backend session is gone.
    await client.evaluate(`document.querySelector('[data-testid="terminate"]').click()`);
    await waitFor(
      client,
      "session terminated in UI",
      `(document.querySelector('[data-testid="debug-state"]')?.textContent ?? '').includes('idle')`,
      20_000,
    );
    const gone = await fetch(`${API_URL}/api/v1/sessions/${encodeURIComponent(sessionId)}`);
    assert(gone.status === 404, `session still exists after UI terminate: ${gone.status}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId,
          before,
          after: { ...after, changedLabels: after.changedLabels.length },
          rspVisible,
          inspector,
          selection: selectionText.includes("selected instruction"),
          terminated: true,
          screenshot: SHOT_PATH,
        },
        null,
        2,
      ),
    );
  } finally {
    if (sessionId) {
      await fetch(`${API_URL}/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
});
