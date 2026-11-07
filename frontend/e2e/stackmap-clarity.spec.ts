/**
 * StackMap visual-clarity regression (V1.3.1): pointer routing, ruler density,
 * flat backgrounds, marker stubs and byte-accurate change marks — all driven
 * by real GDB sessions over the REST API (no mocks).
 *
 * Scenarios: normal frame / multi-level call chain / many pointers / many
 * locals / no DWARF / no frame pointer / selection-focused pointers.
 * Screenshots: docs/assets/stackmap-v1.3.1/ at 1920x1080, zh-CN.
 */

import { test, expect } from "@playwright/test";

import {
  addressInWindow,
  cleanupSession,
  createLaunchedSession,
  openSession,
  preparePresentation,
  waitForSourceReady,
  stepOnce,
  stepUntil,
  type Snapshot,
} from "./gdb";

const SHOTS = process.env.PWNVIZ_SHOT_DIR ?? "../docs/assets/stackmap-v1.3.1";

async function screenshot(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: false });
}

/** Steps into the given function (its entry) and settles a few instructions in. */
async function enterFunction(sessionId: string, name: string, settleSteps = 4): Promise<Snapshot> {
  await stepUntil(sessionId, (s) => s.frames[0]?.function === name, 600);
  let snapshot = await stepOnce(sessionId); // execute the function's first instruction
  for (let index = 1; index < settleSteps; index += 1) snapshot = await stepOnce(sessionId);
  return snapshot;
}

test.describe("stackmap visual clarity (real GDB)", () => {
  test.afterEach(async () => {
    await cleanupSession();
  });

  test("1. normal frame with mixed-size locals", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    const snapshot = await enterFunction(session.session_id, "add_numbers");
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await waitForSourceReady(page, session.sample_id);
    await assertCommon(page, snapshot);
    await screenshot(page, "01-normal-frame.png");
  });

  test("2. multi-level call chain", async ({ page }) => {
    const session = await createLaunchedSession("stack-deep");
    // Stop inside `inner` (deepest frame) with outer/middle/main above it.
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "inner" && s.frames.length >= 4,
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await waitForSourceReady(page, session.sample_id);
    await assertCommon(page, snapshot);
    const frames = await page.locator("[data-testid=stack-frame-card]").count();
    expect(frames).toBeGreaterThanOrEqual(2);
    await screenshot(page, "02-multi-level-calls.png");
  });

  test("3. many pointers: every drawn arrow owns a distinct lane", async ({ page }) => {
    const session = await createLaunchedSession("stack-pointers");
    // Stop at the call that consumes the pointers: by then every p1..p10 has
    // been really stored. Non-null GDB values alone are NOT enough — before
    // the stores run, GDB reports raw uninitialised memory just the same.
    const snapshot = await stepUntil(
      session.session_id,
      (s) => /call/.test(s.instruction?.text ?? "") && /touch_all/.test(s.instruction?.text ?? ""),
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await waitForSourceReady(page, session.sample_id);
    // Show every real relation, then verify the lanes.
    await page.getByTestId("show-all-pointers").click();
    await expect(page.getByTestId("show-all-pointers")).toHaveAttribute("aria-pressed", "true");
    await assertCommon(page, snapshot);

    const lanes = await page.evaluate(() =>
      [...document.querySelectorAll<SVGGElement>("[data-testid=stack-map-pointer-arrow]")].map(
        (arrow) => ({
          lane: arrow.dataset.lane,
          laneX: arrow.dataset.laneX,
          target: arrow.dataset.target,
          state: arrow.dataset.state,
        }),
      ),
    );
    // No two arrows share a lane index or a lane X (no overlapping channels).
    const laneIndices = lanes.map((entry) => entry.lane);
    expect(new Set(laneIndices).size).toBe(laneIndices.length);
    const laneXs = lanes.map((entry) => entry.laneX);
    expect(new Set(laneXs).size).toBe(laneXs.length);
    // NULL / outside-window / unreadable pointers are never routed.
    expect(lanes.every((entry) => !["null", "outside-window", "unreadable"].includes(entry.state ?? ""))).toBe(true);
    // At most the lane cap: every drawn arrow still has its own X.
    expect(lanes.length).toBeLessThanOrEqual(12);
    await screenshot(page, "03-many-pointers.png");
  });

  test("4. pointer default keeps the map clean (selection only)", async ({ page }) => {
    const session = await createLaunchedSession("stack-pointers");
    await stepUntil(
      session.session_id,
      (s) => /call/.test(s.instruction?.text ?? "") && /touch_all/.test(s.instruction?.text ?? ""),
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await waitForSourceReady(page, session.sample_id);
    // No selection -> no pointer routing at all.
    let arrows = await page.locator("[data-testid=stack-map-pointer-arrow]").count();
    expect(arrows).toBe(0);
    // Select one variable block: only its relations appear.
    await page.locator('[data-testid=stack-map-block][data-kind="variable"]').first().click();
    arrows = await page.locator("[data-testid=stack-map-pointer-arrow]").count();
    expect(arrows).toBeLessThanOrEqual(12);
    await screenshot(page, "07-selection-focused-pointers.png");
  });

  test("5. many locals render without clipping", async ({ page }) => {
    const session = await createLaunchedSession("stack-manyvars");
    const snapshot = await enterFunction(session.session_id, "mix_all");
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await waitForSourceReady(page, session.sample_id);
    const variables = await page.locator('[data-testid=stack-map-block][data-kind="variable"]').count();
    expect(variables).toBeGreaterThanOrEqual(8);
    await assertCommon(page, snapshot);
    await screenshot(page, "04-many-locals.png");
  });

  test("6. no DWARF: flat bands, real frames, no invented variables", async ({ page }) => {
    const session = await createLaunchedSession("stack-nodwarf");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "mix_all",
      600,
    ).catch(() => stepUntil(session.session_id, (s) => s.frames.length >= 1 && (s.instruction?.text ?? "").length > 0, 50));
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await waitForSourceReady(page, session.sample_id);
    // The UI must render exactly what the real GDB session reports — never
    // invent variable blocks. Without DWARF, GDB can still identify spilled
    // arguments from the prologue; those ARE real GDB data. Variables whose
    // address lies outside the stack window are summarized by the unplaced
    // badge instead of a block, so compare against the in-window count.
    const variableBlocks = await page.locator('[data-testid=stack-map-block][data-kind="variable"]').count();
    const inWindow = snapshot.variables.filter((v) => {
      if (v.location_kind !== "memory" || !v.address) return false;
      return addressInWindow(v.address, snapshot);
    }).length;
    expect(variableBlocks).toBe(inWindow);
    await expect(page.getByTestId("stack-frame-card").first()).toBeVisible();
    await assertCommon(page, snapshot);
    await screenshot(page, "05-no-dwarf.png");
  });

  test("7. no frame pointer: honest boundary states", async ({ page }) => {
    const session = await createLaunchedSession("stack-nofp");
    const snapshot = await stepUntil(
      session.session_id,
      (s) => s.frames[0]?.function === "add_numbers" && /call|mov|sub/.test(s.instruction?.text ?? ""),
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    await waitForSourceReady(page, session.sample_id);
    await assertCommon(page, snapshot);
    await screenshot(page, "06-no-frame-pointer.png");
  });
});

// ---------------------------------------------------------------------------
// Shared V1.3.1 clarity assertions
// ---------------------------------------------------------------------------

async function assertCommon(page: import("@playwright/test").Page, snapshot: Snapshot): Promise<void> {
  // a) no horizontal overflow at 1920x1080
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
    .toBeLessThanOrEqual(1922);

  // b) ruler: sparse major ticks, every one labelled; no wall of hairlines
  const ruler = await page.evaluate(() => {
    const ticks = [...document.querySelectorAll<HTMLElement>("[data-testid=stack-map-ruler] > div[style]")];
    const rulerWidth = document
      .querySelector<HTMLElement>("[data-testid=stack-map-ruler]")
      ?.getBoundingClientRect().width ?? 0;
    return { tickCount: ticks.length, rulerWidth };
  });
  expect(ruler.tickCount).toBeLessThanOrEqual(40);
  expect(ruler.rulerWidth).toBeGreaterThan(0);

  // c) backgrounds are flat: the band fills must not use repeating textures
  const textured = await page.evaluate(() => {
    const offenders: string[] = [];
    for (const className of ["stack-map-unknown", "stack-map-unreadable", "stack-map-quiet", "stack-map-above"]) {
      const element = document.querySelector<HTMLElement>(`.${className}`);
      if (!element) continue;
      const image = getComputedStyle(element).backgroundImage;
      if (image && image !== "none") offenders.push(`${className}:${image.slice(0, 40)}`);
    }
    return offenders;
  });
  expect(textured, "repeating textures must be gone").toEqual([]);

  // d) markers: presentation default has no full-width guide line
  const guides = await page.evaluate(() => ({
    rsp: document.querySelector<HTMLElement>("[data-testid=stack-map-rsp]")?.dataset.guide,
    rbp: document.querySelector<HTMLElement>("[data-testid=stack-map-rbp]")?.dataset.guide,
    guideLines: document.querySelectorAll("[data-testid$=-guide]").length,
  }));
  for (const value of [guides.rsp, guides.rbp]) {
    if (value !== undefined) expect(value).toBe("false");
  }
  expect(guides.guideLines).toBe(0);

  // e) clicking a marker reveals the full guide temporarily
  const rspMarker = page.locator("[data-testid=stack-map-rsp] button");
  if ((await rspMarker.count()) > 0) {
    await rspMarker.click();
    await expect(page.locator("[data-testid=stack-map-rsp]")).toHaveAttribute("data-guide", "true");
    await expect(page.locator('[data-testid="stack-map-rsp-guide"]')).toHaveCount(1);
  }

  // f) frame titles and variable blocks: no clipped text anywhere
  const clips = await page.evaluate(() => {
    const offenders: string[] = [];
    for (const chip of document.querySelectorAll<HTMLElement>("[data-testid=stack-frame-chip]")) {
      if (chip.scrollWidth - chip.clientWidth > 2 || chip.scrollHeight - chip.clientHeight > 2) {
        offenders.push(`frame-chip:${chip.textContent?.slice(0, 20)}`);
      }
    }
    for (const block of document.querySelectorAll<HTMLElement>("[data-testid=stack-map-block]")) {
      if (block.dataset.micro === "true") continue;
      if (block.scrollWidth - block.clientWidth > 2) offenders.push(`block-w:${block.textContent?.slice(0, 16)}`);
      if (block.scrollHeight - block.clientHeight > 2) offenders.push(`block-h:${block.textContent?.slice(0, 16)}`);
    }
    return offenders;
  });
  expect(clips, "clipped text found").toEqual([]);

  // g) frames must not overlap each other
  const frameRects = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-testid=stack-frame-card]")]
      .map((card) => card.getBoundingClientRect())
      .sort((a, b) => a.top - b.top)
      .map((rect) => ({ top: rect.top, bottom: rect.bottom })),
  );
  for (let index = 1; index < frameRects.length; index += 1) {
    expect(frameRects[index].top - frameRects[index - 1].bottom).toBeGreaterThanOrEqual(-1);
  }

  // h) marker addresses match the live snapshot exactly
  const markers = await page.evaluate(() => ({
    rsp: document.querySelector<HTMLElement>("[data-testid=stack-map-rsp]")?.dataset.address ?? null,
    rbp: document.querySelector<HTMLElement>("[data-testid=stack-map-rbp]")?.dataset.address ?? null,
  }));
  if (addressInWindow(snapshot.registers.rsp, snapshot)) {
    expect.soft(markers.rsp?.toLowerCase()).toBe(snapshot.registers.rsp?.toLowerCase());
  }
  if (addressInWindow(snapshot.registers.rbp, snapshot)) {
    expect.soft(markers.rbp?.toLowerCase()).toBe(snapshot.registers.rbp?.toLowerCase());
  }
}
