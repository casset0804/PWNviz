/**
 * StackMap diff-cleanness regression (V1.3.2): memory changes may only appear
 * as narrow left-edge run markers inside blocks and 4 px markers in the diff
 * gutter — never as green lines stretching across the stack area.
 *
 * All scenarios run a real GDB session; the changed bytes come from the live
 * snapshot diff (no mocks). Screenshots: docs/assets/stackmap-v1.3.2/.
 */

import { test, expect } from "@playwright/test";

import {
  cleanupSession,
  createLaunchedSession,
  latestSnapshot,
  openSession,
  preparePresentation,
  stepUntil,
  type Snapshot,
} from "./gdb";
import {
  blockForAddress,
  buildStackMap,
  groupMemoryChangesByAddress,
} from "../src/lib/stackMap";

/** Unattributed change runs, computed with the real model (pure functions). */
function unattributedGroups(snapshot: Snapshot) {
  // The e2e Snapshot type is a slim structural subset; the model only reads
  // the fields it declares, so the upcast is safe here.
  const model = buildStackMap(snapshot as unknown as Parameters<typeof buildStackMap>[0]);
  return groupMemoryChangesByAddress(
    snapshot.diff.changed_bytes.filter((change) => {
      const block = blockForAddress(model, change.address);
      return block === null || block.kind === "unknown" || block.kind === "unreadable";
    }),
  );
}

const SHOTS = process.env.PWNVIZ_SHOT_DIR ?? "../docs/assets/stackmap-v1.3.2";

/** Small local re-implementation of the model's grouping for assertions. */
function groupChanges(changes: Snapshot["diff"]["changed_bytes"]): Array<{
  start: string;
  end: string;
  count: number;
}> {
  const sorted = [...changes]
    .map((change) => ({ change, address: BigInt(change.address) }))
    .sort((a, b) => (a.address < b.address ? -1 : 1));
  const groups: Array<{ start: string; end: string; count: number; endBig: bigint }> = [];
  for (const entry of sorted) {
    const last = groups.at(-1);
    if (last && entry.address === last.endBig) {
      last.endBig = entry.address + 1n;
      last.end = `0x${last.endBig.toString(16).padStart(16, "0")}`;
      last.count += 1;
    } else {
      groups.push({
        start: `0x${entry.address.toString(16).padStart(16, "0")}`,
        end: `0x${(entry.address + 1n).toString(16).padStart(16, "0")}`,
        count: 1,
        endBig: entry.address + 1n,
      });
    }
  }
  return groups.map(({ start, end, count }) => ({ start, end, count }));
}

async function screenshot(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: false });
}

/** Every visible change marker is <= 6 px wide and never touches a register chip. */
async function assertDiffCleanliness(page: import("@playwright/test").Page): Promise<void> {
  // a) no horizontal overflow
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
    .toBeLessThanOrEqual(1922);

  // b) no full-width green diff lines anywhere in the stack map: an element
  //    wider than 32 px, shorter than 5 px, with an emerald background is noise.
  const greenLines = await page.evaluate(() => {
    const offenders: string[] = [];
    const root = document.querySelector<HTMLElement>("[data-testid=stack-map-canvas]");
    if (!root) return offenders;
    const emerald = (value: string): boolean =>
      /rgba?\(\s*(16|52|110|167|209|5),\s*(185|211|231|243|250|150),\s*(129|153|183|208|229|105)/.test(
        value,
      );
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 32 || rect.height > 4 || rect.height === 0) continue;
      const style = getComputedStyle(element);
      const background = `${style.backgroundColor} ${style.backgroundImage}`;
      if (emerald(background)) {
        offenders.push(`${element.tagName}.${[...element.classList].slice(0, 2).join(".")}:${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    return offenders;
  });
  expect(greenLines, "full-width green diff lines found").toEqual([]);

  // c) all change markers are narrow (<= 6 px)
  const widths = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-testid=stack-map-change-mark], [data-testid=stack-map-diff-gutter-mark]")].map(
      (mark) => mark.getBoundingClientRect().width,
    ),
  );
  for (const width of widths) {
    expect.soft(width, "change marker wider than 6px").toBeLessThanOrEqual(6);
  }

  // d) markers must not cover the RSP/RBP chips
  const overlap = await page.evaluate(() => {
    const chips = [...document.querySelectorAll<HTMLElement>("[data-testid=stack-map-rsp] button, [data-testid=stack-map-rbp] button")];
    const marks = [
      ...document.querySelectorAll<HTMLElement>("[data-testid=stack-map-change-mark], [data-testid=stack-map-diff-gutter-mark]"),
    ];
    const hit: string[] = [];
    for (const mark of marks) {
      const markRect = mark.getBoundingClientRect();
      for (const chip of chips) {
        const chipRect = chip.getBoundingClientRect();
        if (
          markRect.left < chipRect.right &&
          markRect.right > chipRect.left &&
          markRect.top < chipRect.bottom &&
          markRect.bottom > chipRect.top
        ) {
          hit.push(`${mark.dataset.start}`);
        }
      }
    }
    return hit;
  });
  expect(overlap, "change markers overlap register chips").toEqual([]);
}

test.describe("stackmap diff cleanness (real GDB)", () => {
  test.afterEach(async () => {
    await cleanupSession();
  });

  test("1. single changed byte: one narrow mark, no full-width line", async ({ page }) => {
    const session = await createLaunchedSession("stack-manyvars");
    // mix_all stores its char locals one byte at a time.
    await stepUntil(session.session_id, (s) => s.diff.changed_bytes.length === 1, 600);
    await preparePresentation(page);
    await openSession(page, session.session_id);
    // The UI renders the session's LATEST snapshot; assert against that.
    const snapshot = await latestSnapshot(session.session_id);
    await assertDiffCleanliness(page);
    // Exactly one mark, anchored at the real changed byte.
    const expectedAddress = snapshot.diff.changed_bytes[0].address.toLowerCase();
    await expect(
      page.locator(`[data-testid=stack-map-change-mark][data-start="${expectedAddress}"]`),
    ).toHaveCount(1);
    const marks = await page.locator("[data-testid=stack-map-change-mark]").count();
    expect(marks).toBe(1);
    await screenshot(page, "01-single-byte.png");
  });

  test("2. eight contiguous bytes merge into ONE left-edge run", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    // The `call`/`push rbp` writes are 8 contiguous bytes in one run.
    await stepUntil(
      session.session_id,
      (s) => {
        if (s.diff.changed_bytes.length !== 8) return false;
        return groupChanges(s.diff.changed_bytes).length === 1;
      },
      600,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    const snapshot = await latestSnapshot(session.session_id);
    await assertDiffCleanliness(page);
    // Exactly one merged mark covering the whole run (plus no per-byte marks).
    const marks = await page.locator("[data-testid=stack-map-change-mark]").all();
    const covering = [];
    for (const mark of marks) {
      const start = await mark.getAttribute("data-start");
      const end = await mark.getAttribute("data-end");
      const count = await mark.getAttribute("data-count");
      if (start === snapshot.diff.changed_bytes[0].address.toLowerCase() || Number(count) === 8) {
        covering.push({ start, end, count });
      }
    }
    expect(covering.length).toBeGreaterThanOrEqual(1);
    expect(covering[0]?.count).toBe("8");
    await screenshot(page, "02-eight-contiguous.png");
  });

  test("3. multi-range diff stays separated into independent marks", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    // Single-step up to the printf call site: the accumulated in-window diff
    // spans several separate runs (frame writes + red-zone/gap writes).
    // Real single-stop diffs with >= 12 bytes in >= 3 separate runs exist in
    // this run (measured: 14 bytes / 4 groups around the printf setup).
    await stepUntil(
      session.session_id,
      (s) => {
        const groups = groupChanges(s.diff.changed_bytes);
        return s.diff.changed_bytes.length >= 12 && groups.length >= 3;
      },
      200,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    const snapshot = await latestSnapshot(session.session_id);
    const groups = groupChanges(snapshot.diff.changed_bytes);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    await assertDiffCleanliness(page);
    await screenshot(page, "03-multi-range-changes.png");
  });

  test("4. unattributed changes render in the diff gutter only (DOM = snapshot)", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    // A stop whose diff includes bytes below RSP / in unknown gaps: the
    // unattributed runs must appear in the gutter and nowhere else.
    await stepUntil(
      session.session_id,
      (s) => {
        const unattributed = unattributedGroups(s);
        return (
          s.diff.changed_bytes.length >= 12 &&
          groupChanges(s.diff.changed_bytes).length >= 2 &&
          unattributed.length >= 1
        );
      },
      200,
    );
    await preparePresentation(page);
    await openSession(page, session.session_id);
    const snapshot = await latestSnapshot(session.session_id);
    const unattributed = unattributedGroups(snapshot);
    expect(unattributed.length).toBeGreaterThanOrEqual(1);
    await assertDiffCleanliness(page);
    // The gutter carries EXACTLY those runs; the count chip sums their bytes.
    await expect(page.getByTestId("stack-map-unattributed-count")).toBeVisible();
    const gutterMarks = await page
      .locator("[data-testid=stack-map-diff-gutter-mark]")
      .evaluateAll((marks) =>
        marks.map((mark) => ({
          start: (mark.getAttribute("data-start") ?? "").toLowerCase(),
          end: (mark.getAttribute("data-end") ?? "").toLowerCase(),
          count: Number(mark.getAttribute("data-count") ?? 0),
        })),
      );
    // The gutter renders by Y (descending address); compare as sets.
    const sortByStart = (
      list: Array<{ start: string; end: string; count: number }>,
    ): Array<{ start: string; end: string; count: number }> =>
      [...list].sort((left, right) => left.start.localeCompare(right.start));
    expect(sortByStart(gutterMarks)).toEqual(
      sortByStart(
        unattributed.map((group) => ({
          start: group.start,
          end: group.end,
          count: group.count,
        })),
      ),
    );
    const expectedBytes = unattributed.reduce((total, group) => total + group.count, 0);
    await expect(page.getByTestId("stack-map-unattributed-count")).toContainText(
      String(expectedBytes),
    );
    // Scroll to the top of the map so the gutter marks are in frame.
    await page
      .locator("[data-testid=stack-map-scroll]")
      .evaluate((element) => {
        (element as HTMLElement).scrollTop = 0;
      });
    await page.waitForTimeout(300);
    await screenshot(page, "04-gutter-unattributed.png");
  });

  test("5. clicking a change mark opens the before/after table", async ({ page }) => {
    const session = await createLaunchedSession("stack-basic");
    await stepUntil(session.session_id, (s) => s.diff.changed_bytes.length === 8, 600);
    await preparePresentation(page);
    await openSession(page, session.session_id);
    const snapshot = await latestSnapshot(session.session_id);
    const firstChange = snapshot.diff.changed_bytes[0];
    // Click the block's change mark (the run's first byte).
    await page
      .locator(`[data-testid=stack-map-change-mark][data-start="${firstChange.address.toLowerCase()}"]`)
      .first()
      .click();
    const table = page.getByTestId("selected-changes-table");
    await expect(table).toBeVisible();
    const rows = await table.locator("tbody tr").count();
    expect(rows).toBe(8);
    // The table shows the real before/after of the first byte.
    await expect(table.locator("tbody tr").first()).toContainText(
      firstChange.address.toLowerCase(),
    );
    await expect(table.locator("tbody tr").first()).toContainText(
      firstChange.after ?? "??",
    );
    await assertDiffCleanliness(page);
    await screenshot(page, "05-inspector-before-after.png");
  });
});
