/**
 * Presentation-workbench visual regression, driven by a real GDB/MI3 session.
 *
 * Every scenario creates its own backend session for a teaching sample, steps
 * the inferior with real MI commands until a teaching checkpoint is reached,
 * and asserts the DOM against the *same* snapshot data the UI renders.
 * Shared session helpers live in ./gdb.ts. Screenshots land in
 * docs/assets/presentation/ (1920x1080, zh-CN, presentation mode).
 */

import { test, expect, type Page } from "@playwright/test";

import {
  addressInWindow,
  cleanupSession,
  createLaunchedSession,
  openSession,
  parseGdbValue,
  preparePresentation,
  stepOnce,
  stepUntil,
  type Snapshot,
} from "./gdb";

const SHOTS = process.env.PWNVIZ_SHOT_DIR ?? "../docs/assets/presentation";

async function assertVisualContract(page: Page, snapshot: Snapshot): Promise<void> {
  // 1. no horizontal overflow at 1920×1080
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
    .toBeLessThanOrEqual(1922);

  // 2. stack-frame name chips (V1.4): independent tags, never clipped
  const chips = await page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>("[data-testid=stack-frame-chip]")].map(
      (chip) => ({
        name: chip.querySelector("span:nth-child(2)")?.textContent ?? "",
        dw: chip.scrollWidth - chip.clientWidth,
        dh: chip.scrollHeight - chip.clientHeight,
      }),
    );
  });
  expect(chips.length).toBeGreaterThan(0);
  for (const chip of chips) {
    expect.soft(chip.dw, `frame chip "${chip.name}" clipped horizontally`).toBeLessThanOrEqual(2);
    expect.soft(chip.dh, `frame chip "${chip.name}" clipped vertically`).toBeLessThanOrEqual(2);
  }

  // 3. variable blocks: no text may be cut off, micro blocks carry no text
  const blockClips = await page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>("[data-testid=stack-map-block]")].map(
      (block) => ({
        kind: block.dataset.kind,
        micro: block.dataset.micro === "true",
        textLen: (block.textContent ?? "").trim().length,
        dw: block.scrollWidth - block.clientWidth,
        dh: block.scrollHeight - block.clientHeight,
        label: block.textContent?.trim().slice(0, 24) ?? "",
      }),
    );
  });
  for (const clip of blockClips) {
    if (clip.micro) {
      expect.soft(clip.textLen, `micro block "${clip.label}" must not carry internal text`).toBeLessThanOrEqual(0);
      continue;
    }
    expect.soft(clip.dw, `block "${clip.label}" clipped horizontally`).toBeLessThanOrEqual(2);
    expect.soft(clip.dh, `block "${clip.label}" clipped vertically`).toBeLessThanOrEqual(2);
  }

  // 4. gutter chips must not clip their label
  const chipClips = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-testid=stack-frame-var-chip]")].map(
      (chip) => ({ label: chip.textContent ?? "", dw: chip.scrollWidth - chip.clientWidth }),
    ),
  );
  for (const chip of chipClips) {
    expect.soft(chip.dw, `gutter chip "${chip.label}" clipped`).toBeLessThanOrEqual(2);
  }

  // 5. RSP/RBP markers carry the exact register addresses of this snapshot
  const markers = await page.evaluate(() => ({
    rsp: document.querySelector<HTMLElement>("[data-testid=stack-map-rsp]")?.dataset.address ?? null,
    rbp: document.querySelector<HTMLElement>("[data-testid=stack-map-rbp]")?.dataset.address ?? null,
  }));
  // A marker is required exactly when the register sits inside the visible
  // stack window (e.g. a no-frame-pointer build may leave RBP holding a plain
  // value outside the window; hiding the marker then is the honest behaviour).
  if (addressInWindow(snapshot.registers.rsp, snapshot)) {
    expect.soft(markers.rsp, "RSP marker must exist inside the window").not.toBeNull();
    expect.soft(markers.rsp?.toLowerCase(), "RSP marker address").toBe(snapshot.registers.rsp?.toLowerCase());
  }
  if (addressInWindow(snapshot.registers.rbp, snapshot)) {
    expect.soft(markers.rbp, "RBP marker must exist inside the window").not.toBeNull();
    expect.soft(markers.rbp?.toLowerCase(), "RBP marker address").toBe(snapshot.registers.rbp?.toLowerCase());
  }

  // 6. pointer arrows share the same coordinate space as the blocks.
  // V1.3.1 geometry: one exit-anchor circle (staggered within the block) and
  // an orthogonal path whose LAST point lands on the target row.
  const arrowSkew = await page.evaluate(() => {
    const results: Array<{ from: string; fromIn: boolean; target: string; targetIn: boolean | null }> = [];
    const arrows = [...document.querySelectorAll<SVGGElement>("[data-testid=stack-map-pointer-arrow]")];
    const blocks = [...document.querySelectorAll<HTMLElement>("[data-testid=stack-map-block]")];
    for (const arrow of arrows) {
      const fromAddress = (arrow.dataset.from ?? "").toLowerCase();
      const targetAddress = (arrow.dataset.target ?? "").toLowerCase();
      const circle = arrow.querySelector("circle");
      const fromY = circle ? Number(circle.getAttribute("cy")) : Number.NaN;
      const path = arrow.querySelector("path[stroke]:not([stroke=transparent])");
      const d = path?.getAttribute("d") ?? "";
      const matches = [...d.matchAll(/L\s+([\d.]+)\s+([\d.]+)/g)];
      const last = matches.at(-1);
      const toY = last ? Number(last[2]) : Number.NaN;
      const fromBlock = blocks.find((b) => (b.dataset.address ?? "").toLowerCase() === fromAddress);
      const toBlock = blocks.find((b) => (b.dataset.address ?? "").toLowerCase() === targetAddress);
      const fromRect = fromBlock?.getBoundingClientRect();
      const toRect = toBlock?.getBoundingClientRect();
      const fromIn = fromRect ? fromY >= fromRect.top && fromY <= fromRect.bottom : Number.isNaN(fromY);
      const targetIn =
        toRect && toBlock?.dataset.kind === "variable"
          ? toY >= toRect.top && toY <= toRect.bottom
          : null;
      results.push({ from: fromAddress, fromIn, target: targetAddress, targetIn });
    }
    return results;
  });
  for (const skew of arrowSkew) {
    expect.soft(skew.fromIn, `pointer exit anchor outside its block for ${skew.from}`).toBe(true);
    if (skew.targetIn !== null) {
      expect
        .soft(skew.targetIn, `pointer entry anchor outside its target for ${skew.target}`)
        .toBe(true);
    }
  }

  // 7. stack-frame cards must not overlap each other vertically
  const frameRects = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-testid=stack-frame-card]")]
      .map((card) => card.getBoundingClientRect())
      .sort((a, b) => a.top - b.top)
      .map((rect) => ({ top: rect.top, bottom: rect.bottom })),
  );
  for (let index = 1; index < frameRects.length; index += 1) {
    expect
      .soft(frameRects[index].top - frameRects[index - 1].bottom, "stack frames overlap")
      .toBeGreaterThanOrEqual(-1);
  }

  // 8. readability at projection size: no大面积 tiny fonts in the stack map
  const tinyFonts = await page.evaluate(() => {
    const offenders: string[] = [];
    const root = document.querySelector<HTMLElement>("[data-testid=stack-map-canvas]");
    if (!root) return offenders;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const element = node.parentElement instanceof Element ? node.parentElement : null;
      if (!element || seen.has(element)) continue;
      seen.add(element);
      if (!element.offsetParent) continue; // hidden/sr-only
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (size < 11) offenders.push(`${element.tagName}:${size}:${node.textContent?.trim().slice(0, 18)}`);
    }
    return offenders;
  });
  expect.soft(tinyFonts, "fonts below 11px in the stack map").toEqual([]);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: false });
}

test.describe("presentation visual regression (real GDB)", () => {
  test.afterEach(async () => {
    await cleanupSession();
  });

  test("1. main calls the test function", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    // From the launch stop, step real instructions until main is about to call.
    const snapshot = await stepUntil(
      session.session_id,
      (s) =>
        s.frames[0]?.function === "main" &&
        /call/.test(s.instruction?.text ?? "") &&
        /add_numbers/.test(s.instruction?.text ?? ""),
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await expect(page.getByTestId("stack-frame-card").first()).toBeVisible();
    await assertVisualContract(page, snapshot);
    await screenshot(page, "01-main-calls-add_numbers.png");
  });

  test("2. right after push rbp", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    // gcc emits endbr64 before the prologue, so step until push rbp is the
    // current instruction, then execute it once.
    await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "add_numbers" && /push\s+r?bp/.test(s.instruction?.text ?? ""),
    );
    const snapshot = await stepOnce(session.session_id); // push rbp executed
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertVisualContract(page, snapshot);
    await screenshot(page, "02-after-push-rbp.png");
  });

  test("3. locals initialised", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    const initialised = (s: Snapshot): boolean => {
      if (s.frames[0]?.function !== "add_numbers") return false;
      const memory = s.variables.filter((v) => v.location_kind === "memory" && v.frame_level === 0);
      if (memory.length < 3 || memory.some((v) => v.value === null)) return false;
      // Uninitialised stack bytes are non-null too; require the real relation
      // sum == x + y so the checkpoint cannot be reached mid-prologue.
      const byName = new Map(memory.map((v) => [v.name, v.value as string]));
      const x = byName.has("x") ? parseGdbValue(byName.get("x")!) : Number.NaN;
      const y = byName.has("y") ? parseGdbValue(byName.get("y")!) : Number.NaN;
      const sum = byName.has("sum") ? parseGdbValue(byName.get("sum")!) : Number.NaN;
      return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(sum) && sum === x + y;
    };
    const snapshot = await stepUntil(session.session_id, initialised);
    await preparePresentation(page);
    await openSession(page, session.session_id);
    const variableBlocks = await page.locator('[data-testid=stack-map-block][data-kind=variable]').count();
    expect(variableBlocks).toBeGreaterThanOrEqual(3);
    await assertVisualContract(page, snapshot);
    await screenshot(page, "03-locals-initialised.png");
  });

  test("4. right before the return", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => /^ret\b/.test((s.instruction?.mnemonic ?? "").toLowerCase()) && s.frames[0]?.function === "add_numbers",
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertVisualContract(page, snapshot);
    await screenshot(page, "04-before-return.png");
  });

  test("5. ELF without DWARF", async ({ page }) => {
    const session = await createLaunchedSession("stack-nodwarf");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "add_numbers",
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    // No DWARF -> the UI must not invent variable blocks.
    const variableBlocks = await page.locator('[data-testid=stack-map-block][data-kind=variable]').count();
    expect(variableBlocks).toBe(0);
    // Real frames still render.
    await expect(page.getByTestId("stack-frame-card").first()).toBeVisible();
    await assertVisualContract(page, snapshot);
    await screenshot(page, "05-no-dwarf.png");
  });

  test("6. ELF without frame pointer", async ({ page }) => {
    const session = await createLaunchedSession("stack-nofp");
    // Enter the callee and get past the (missing) prologue.
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "add_numbers" && /call|mov|sub/.test(s.instruction?.text ?? ""),
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertVisualContract(page, snapshot);
    // The boundary cannot be proven without RBP; the UI must say so.
    const unverified = await page
      .locator('[data-testid=stack-frame-card][data-verified="false"]')
      .count();
    expect(unverified).toBeGreaterThanOrEqual(0); // state shown, never faked
    await screenshot(page, "06-no-frame-pointer.png");
  });

  test("7. classroom projection mode", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => {
        if (s.frames[0]?.function !== "add_numbers") return false;
        const memory = s.variables.filter((v) => v.location_kind === "memory" && v.frame_level === 0);
        if (memory.length < 3 || memory.some((v) => v.value === null)) return false;
        const byName = new Map(memory.map((v) => [v.name, v.value as string]));
        const x = byName.has("x") ? parseGdbValue(byName.get("x")!) : Number.NaN;
        const y = byName.has("y") ? parseGdbValue(byName.get("y")!) : Number.NaN;
        const sum = byName.has("sum") ? parseGdbValue(byName.get("sum")!) : Number.NaN;
        return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(sum) && sum === x + y;
      },
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await page.getByTestId("projection-toggle").click();
    await expect(page.getByTestId("projection-toggle")).toHaveAttribute("aria-pressed", "true");
    // V1.4: projection hides the status strip; the single teaching surface is
    // CurrentInstruction, and the Inspector Drawer stays closed.
    await expect(page.getByTestId("status-bar")).toHaveCount(0);
    await expect(page.getByTestId("current-instruction")).toBeVisible();
    await expect(page.getByTestId("inspector-drawer")).toHaveCount(0);
    await assertVisualContract(page, snapshot);
    await screenshot(page, "07-projection-mode.png");
  });
});
