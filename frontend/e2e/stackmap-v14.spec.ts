/**
 * V1.4 stack-centric layout acceptance (real GDB, no mocks).
 *
 * Validates the redesigned presentation mode: a centered, fixed-width memory
 * spine as the largest visual region, addresses on the left, RSP/RBP locators
 * on the right, exactly ONE teaching surface, the Inspector Drawer carrying
 * the former bottom panel, and readable source/disassembly on the left.
 * Screenshots: docs/assets/v1.4/.
 */

import { test, expect } from "@playwright/test";

import {
  addressInWindow,
  cleanupSession,
  createLaunchedSession,
  latestSnapshot,
  openSession,
  preparePresentation,
  stepOnce,
  stepUntil,
  type Snapshot,
} from "./gdb";

const SHOTS = process.env.PWNVIZ_SHOT_DIR ?? "../docs/assets/v1.4";

async function screenshot(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: false });
}

/** Steps into the named function and settles a few instructions in. */
async function enterFunction(sessionId: string, name: string, settleSteps = 4): Promise<Snapshot> {
  await stepUntil(sessionId, (s) => s.frames[0]?.function === name, 600);
  let snapshot = await stepOnce(sessionId);
  for (let index = 1; index < settleSteps; index += 1) snapshot = await stepOnce(sessionId);
  return snapshot;
}

/** V1.4 layout contract, shared by every scenario. */
async function assertLayoutContract(
  page: import("@playwright/test").Page,
  snapshot: Snapshot,
): Promise<void> {
  // a) no horizontal overflow at 1920x1080
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
    .toBeLessThanOrEqual(1922);

  // b) the memory spine: fixed width <= 360, centered with real whitespace
  const geometry = await page.evaluate(() => {
    const spine = document.querySelector<HTMLElement>("[data-testid=stack-map-spine]");
    const canvas = document.querySelector<HTMLElement>("[data-testid=stack-map-canvas]");
    const ruler = document.querySelector<HTMLElement>("[data-testid=stack-map-ruler]");
    const spineRect = spine?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      spineWidth: spineRect?.width ?? 0,
      spineLeftGap: spineRect ? spineRect.left - (canvasRect?.left ?? 0) : 0,
      spineRightGap: spineRect && canvasRect ? canvasRect.right - spineRect.right : 0,
      rulerRight: ruler ? ruler.getBoundingClientRect().right : 0,
      spineLeft: spineRect?.left ?? 0,
      spineHeight: spineRect?.height ?? 0,
      canvasHeight: canvasRect?.height ?? 0,
    };
  });
  expect(geometry.spineWidth, "spine width must stay within 360px").toBeLessThanOrEqual(360.5);
  expect(geometry.spineWidth, "spine must keep its fixed width").toBeGreaterThanOrEqual(319);
  expect(geometry.spineLeftGap, "spine must not hug the left edge").toBeGreaterThan(60);
  expect(geometry.spineRightGap, "spine must not hug the right edge").toBeGreaterThan(60);
  expect(geometry.rulerRight, "addresses live left of the spine").toBeLessThanOrEqual(
    geometry.spineLeft + 2,
  );
  // The stack map owns the dominant share of the page height.
  expect(geometry.canvasHeight, "stack map height").toBeGreaterThan(560);

  // c) RSP/RBP chips sit right of the spine and match the live snapshot
  const markers = await page.evaluate(() => {
    const spine = document
      .querySelector<HTMLElement>("[data-testid=stack-map-spine]")
      ?.getBoundingClientRect();
    // Rect from the CHIP button; data-address lives on the wrapper.
    const rspWrap = document.querySelector<HTMLElement>("[data-testid=stack-map-rsp]");
    const rbpWrap = document.querySelector<HTMLElement>("[data-testid=stack-map-rbp]");
    const rsp = rspWrap?.querySelector<HTMLElement>("button");
    const rbp = rbpWrap?.querySelector<HTMLElement>("button");
    return {
      rspLeft: rsp?.getBoundingClientRect().left ?? null,
      rbpLeft: rbp?.getBoundingClientRect().left ?? null,
      spineRight: spine?.right ?? 0,
      rspAddress: rspWrap?.dataset.address ?? null,
      rbpAddress: rbpWrap?.dataset.address ?? null,
      guideLines: document.querySelectorAll("[data-testid$=-guide]").length,
    };
  });
  for (const left of [markers.rspLeft, markers.rbpLeft]) {
    if (left !== null) expect(left, "register locator right of the spine").toBeGreaterThan(markers.spineRight);
  }
  // No spine-crossing guide line by default.
  expect(markers.guideLines).toBe(0);
  if (addressInWindow(snapshot.registers.rsp, snapshot)) {
    expect.soft(markers.rspAddress?.toLowerCase()).toBe(snapshot.registers.rsp?.toLowerCase());
  }
  if (addressInWindow(snapshot.registers.rbp, snapshot)) {
    expect.soft(markers.rbpAddress?.toLowerCase()).toBe(snapshot.registers.rbp?.toLowerCase());
  }

  // d) exactly ONE teaching surface: CurrentInstruction; no bottom panel
  await expect(page.getByTestId("current-instruction")).toBeVisible();
  await expect(page.getByTestId("teaching-panel")).toHaveCount(0);

  // e) the source/disassembly column is readable (>= 340 px)
  const sourceWidth = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("[data-testid=presentation-workbench] > div:first-child");
    return panel?.getBoundingClientRect().width ?? 0;
  });
  expect(sourceWidth, "source column readable").toBeGreaterThanOrEqual(338);

  // f) blocks never stretch beyond the spine
  const overhang = await page.evaluate(() => {
    const spine = document
      .querySelector<HTMLElement>("[data-testid=stack-map-spine]")
      ?.getBoundingClientRect();
    if (!spine) return 999;
    let worst = 0;
    for (const block of document.querySelectorAll<HTMLElement>("[data-testid=stack-map-block]")) {
      const rect = block.getBoundingClientRect();
      worst = Math.max(worst, rect.right - spine.right, spine.left - rect.left);
    }
    return worst;
  });
  expect(overhang, "memory blocks must stay inside the spine").toBeLessThanOrEqual(2);

  // g) no full-width green diff lines (computed-style scan)
  const greenLines = await page.evaluate(() => {
    const offenders: string[] = [];
    const root = document.querySelector<HTMLElement>("[data-testid=stack-map-canvas]");
    if (!root) return offenders;
    const emerald = (value: string): boolean =>
      /rgba?\(\s*(16|52|110|167|209|5),\s*(185|211|231|243|250|150),\s*(129|153|183|208|229|105)/.test(value);
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 32 || rect.height > 4 || rect.height === 0) continue;
      const style = getComputedStyle(element);
      if (emerald(`${style.backgroundColor} ${style.backgroundImage}`)) {
        offenders.push(`${element.tagName}:${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    return offenders;
  });
  expect(greenLines, "full-width green diff lines found").toEqual([]);
}

test.describe("V1.4 stack-centric layout (real GDB)", () => {
  test.afterEach(async () => {
    await cleanupSession();
  });

  test("1. stack-basic", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    const snapshot = await enterFunction(session.session_id, "add_numbers");
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertLayoutContract(page, snapshot);
    // Selecting a block opens the Inspector Drawer with real memory data.
    await page.locator('[data-testid=stack-map-block][data-kind="variable"]').first().click();
    await expect(page.getByTestId("inspector-drawer")).toBeVisible();
    await expect(page.getByTestId("selected-block-detail")).toBeVisible();
    await screenshot(page, "01-stack-basic.png");
  });

  test("2. stack-deep multi-level chain", async ({ page }) => {
    const session = await createLaunchedSession("stack-deep");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "inner" && s.frames.length >= 4,
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertLayoutContract(page, snapshot);
    const frames = await page.locator("[data-testid=stack-frame-card]").count();
    expect(frames).toBeGreaterThanOrEqual(2);
    await screenshot(page, "02-stack-deep.png");
  });

  test("3. stack-manyvars", async ({ page }) => {
    const session = await createLaunchedSession("stack-manyvars");
    const snapshot = await enterFunction(session.session_id, "mix_all");
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertLayoutContract(page, snapshot);
    const variables = await page.locator('[data-testid=stack-map-block][data-kind="variable"]').count();
    expect(variables).toBeGreaterThanOrEqual(8);
    await screenshot(page, "03-stack-manyvars.png");
  });

  test("4. stack-overflow (canary teaching sample)", async ({ page }) => {
    const session = await createLaunchedSession("stack_overflow");
    const snapshot = await enterFunction(session.session_id, "vuln", 2).catch(async () => {
      // The sample's entry function name may differ; any stop two frames deep
      // works for the layout contract.
      await stepUntil(session.session_id, (s) => s.frames.length >= 2, 200);
      return latestSnapshot(session.session_id);
    });
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertLayoutContract(page, snapshot);
    await screenshot(page, "04-stack-overflow.png");
  });

  test("5. no-DWARF sample", async ({ page }) => {
    const session = await createLaunchedSession("stack-nodwarf");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "add_numbers",
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertLayoutContract(page, snapshot);
    await screenshot(page, "05-no-dwarf.png");
  });

  test("6. no-frame-pointer sample", async ({ page }) => {
    const session = await createLaunchedSession("stack-nofp");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "add_numbers" && /call|mov|sub/.test(s.instruction?.text ?? ""),
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await assertLayoutContract(page, snapshot);
    await screenshot(page, "06-no-frame-pointer.png");
  });
});
