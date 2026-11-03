#!/usr/bin/env node
/**
 * End-to-end UI smoke test against a real PWNviz backend + Vite dev server.
 *
 * It drives a headless Chromium/Edge over CDP through the full teaching flow:
 * Run, StepI, Step Into add_numbers, observe RSP, Finish, Continue to exit,
 * Restart; it also verifies WebSocket status/breakpoints/GDB log events and
 * byte-cell selection, then writes a screenshot.
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
const VAR_SHOT_PATH = resolve(
  process.env.PWNVIZ_VAR_SHOT ?? "docs/assets/workbench-variables.png",
);
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
    await waitFor(
      client,
      "WebSocket live",
      `(document.querySelector('[data-testid="stream-status"]')?.textContent ?? '').includes('open')`,
      30_000,
    );
    await waitFor(
      client,
      "breakpoint event",
      `!(document.querySelector('[data-testid="breakpoint-count"]')?.textContent ?? '').startsWith('0 ')`,
      30_000,
    );
    await waitFor(
      client,
      "status bar stopped",
      `(document.querySelector('[data-testid="status-state"]')?.textContent ?? '').trim() === 'Stopped'`,
      10_000,
    );
    const breakpointText = await client.evaluate(
      `document.querySelector('[data-testid="breakpoint-count"]')?.textContent ?? ''`,
    );
    const restartDisabled = await client.evaluate(
      `document.querySelector('[data-testid="restart"]')?.disabled ?? null`,
    );

    await client.evaluate(`document.querySelector('[data-testid="tab-variables"]').click()`);
    await waitFor(
      client,
      "DWARF variables",
      `document.querySelectorAll('[data-testid="variable-row"]').length > 0`,
      20_000,
    );
    const variablesText = await client.evaluate(
      `document.querySelector('[data-testid="variables-panel"]')?.textContent ?? ''`,
    );
    assert(variablesText.includes("dwarf") && variablesText.includes("debug-info"), "variable provenance missing");
    const variablesShot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    writeFileSync(VAR_SHOT_PATH, Buffer.from(variablesShot.data, "base64"));
    await client.evaluate(`document.querySelector('[data-testid="tab-memory"]').click()`);

    // Debug Log must contain live GDB/MI output events, not just local UI actions.
    await client.evaluate(`document.querySelector('[data-testid="tab-log"]').click()`);
    await waitFor(
      client,
      "debugger.output log line",
      `document.querySelectorAll('[data-testid="debug-log-entry"][data-level="gdb"]').length > 0`,
      20_000,
    );
    const debugLogText = await client.evaluate(
      `document.querySelector('[data-testid="debug-log-panel"]')?.textContent ?? ''`,
    );
    await client.evaluate(`document.querySelector('[data-testid="tab-memory"]').click()`);
    let before = await client.evaluate(`({
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

    // Full acceptance flow: main → call → step into add_numbers → finish →
    // continue to exit → restart, all on the same page.
    const callAddress = await client.evaluate(`(() => {
      const line = Array.from(document.querySelectorAll('[data-testid="disassembly-line"]'))
        .find((node) => node.textContent.includes('call') && node.textContent.includes('add_numbers'));
      return line?.querySelector('span')?.textContent ?? '';
    })()`);
    assert(callAddress.startsWith("0x"), `call address not found: ${callAddress}`);

    let rip = after.rip;
    for (let index = 0; index < 30 && rip !== callAddress; index += 1) {
      await waitFor(
        client,
        "StepI enabled during approach",
        `(() => !document.querySelector('[data-testid="step-instruction"]')?.disabled)()`,
        15_000,
      );
      const previousRip = rip;
      await client.evaluate(`document.querySelector('[data-testid="step-instruction"]').click()`);
      rip = await waitFor(
        client,
        "StepI RIP change",
        `(() => {
          const value = document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value') ?? '';
          return value !== ${JSON.stringify(previousRip)} ? value : '';
        })()`,
        20_000,
      );
    }
    assert(rip === callAddress, `did not reach call address ${callAddress}; rip=${rip}`);
    const rspAtCall = await client.evaluate(
      `document.querySelector('[data-testid="register-rsp"]')?.getAttribute('data-value') ?? ''`,
    );

    await waitFor(
      client,
      "Step Into enabled",
      `(() => !document.querySelector('[data-testid="step-into"]')?.disabled)()`,
      15_000,
    );
    await client.evaluate(`document.querySelector('[data-testid="step-into"]').click()`);
    const ripInside = await waitFor(      client,
      "entered add_numbers",
      `(() => {
        const value = document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value') ?? '';
        const status = document.querySelector('[data-testid="status-state"]')?.textContent ?? '';
        return value !== ${JSON.stringify(callAddress)} && status.includes('Stopped') ? value : '';
      })()`,
      30_000,
    );
    const rspInside = await client.evaluate(
      `document.querySelector('[data-testid="register-rsp"]')?.getAttribute('data-value') ?? ''`,
    );
    assert(BigInt(rspInside) < BigInt(rspAtCall), `RSP did not decrease entering function: ${rspAtCall} -> ${rspInside}`);

    await client.evaluate(`document.querySelector('[data-testid="tab-explanation"]').click()`);
    const explanationText = await waitFor(
      client,
      "instruction explanation",
      `(() => {
        const text = document.querySelector('[data-testid="workbench"]')?.textContent ?? '';
        return text.includes('last executed instruction') &&
          (text.includes('measured differences only') || text.includes('rule:'))
          ? text
          : '';
      })()`,
      20_000,
    );
    assert(
      explanationText.includes("measured differences only") || explanationText.includes("rule:"),
      "explanation panel missing measured/rule state",
    );
    await client.evaluate(`document.querySelector('[data-testid="tab-memory"]').click()`);

    await waitFor(
      client,
      "Finish enabled",
      `(() => !document.querySelector('[data-testid="finish"]')?.disabled)()`,
      15_000,
    );
    await client.evaluate(`document.querySelector('[data-testid="finish"]').click()`);
    await waitFor(
      client,
      "returned from add_numbers",
      `(() => {
        const value = document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value') ?? '';
        const status = document.querySelector('[data-testid="status-state"]')?.textContent ?? '';
        return value !== ${JSON.stringify(ripInside)} && status.includes('Stopped');
      })()`,
      30_000,
    );
    const rspAfterFinish = await client.evaluate(
      `document.querySelector('[data-testid="register-rsp"]')?.getAttribute('data-value') ?? ''`,
    );
    assert(BigInt(rspAfterFinish) > BigInt(rspInside), "RSP did not unwind after finish");

    await waitFor(
      client,
      "Continue enabled",
      `(() => !document.querySelector('[data-testid="continue"]')?.disabled)()`,
      15_000,
    );
    await client.evaluate(`document.querySelector('[data-testid="continue"]').click()`);
    await waitFor(
      client,
      "target exited",
      `(document.querySelector('[data-testid="status-state"]')?.textContent ?? '').includes('Exited')`,
      30_000,
    );
    const exited = await client.evaluate(
      `(document.querySelector('[data-testid="status-state"]')?.textContent ?? '').trim()`,
    );
    assert(exited === "Exited", `unexpected terminal status: ${exited}`);

    const oldSessionId = sessionId;
    await waitFor(
      client,
      "Restart enabled",
      `(() => !document.querySelector('[data-testid="restart"]')?.disabled)()`,
      15_000,
    );
    await client.evaluate(`document.querySelector('[data-testid="restart"]').click()`);
    await waitFor(
      client,
      "restart stopped at main",
      `(() => {
        const status = document.querySelector('[data-testid="status-state"]')?.textContent ?? '';
        const rip = document.querySelector('[data-testid="register-rip"]')?.getAttribute('data-value') ?? '';
        const snap = document.querySelector('[data-testid="snapshot-id"]')?.textContent ?? '';
        return status.includes('Stopped') && rip === ${JSON.stringify(before.rip)} && snap.includes('#1');
      })()`,
      60_000,
    );
    const newSessionId = await client.evaluate(
      `new URLSearchParams(location.search).get('sessionId')`,
    );
    assert(newSessionId && newSessionId !== oldSessionId, "restart did not create a new session");
    sessionId = newSessionId;
    const restarted = true;

    // Terminate the restarted session through the UI.
    await waitFor(
      client,
      "Terminate enabled after restart",
      `(() => !document.querySelector('[data-testid="terminate"]')?.disabled)()`,
      15_000,
    );
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
          breakpoints: breakpointText,
          debugLogHasGdb: debugLogText.includes("gdb"),
          variablesHaveProvenance:
            variablesText.includes("dwarf") && variablesText.includes("debug-info"),
          variablesScreenshot: VAR_SHOT_PATH,
          restartDisabled,
          rspVisible,
          inspector,
          selection: selectionText.includes("selected instruction"),
          fullFlow: {
            callAddress,
            rspAtCall,
            rspInside,
            rspAfterFinish,
            ripInside,
            exited,
            restarted,
            newSessionId,
          },
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
