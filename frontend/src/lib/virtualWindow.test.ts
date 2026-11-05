import { describe, expect, it } from "vitest";

import {
  ROW_HEIGHT_PX,
  VIRTUALIZATION_THRESHOLD,
  computeVirtualWindow,
} from "./virtualWindow";

describe("computeVirtualWindow", () => {
  it("renders every row below the threshold (no virtualisation)", () => {
    const window = computeVirtualWindow(64, 0, 320);
    expect(window.enabled).toBe(false);
    expect(window.start).toBe(0);
    expect(window.end).toBe(64);
    expect(window.paddingTop).toBe(0);
    expect(window.paddingBottom).toBe(0);
  });

  it("enables virtualisation above the threshold and keeps total height exact", () => {
    const rowCount = VIRTUALIZATION_THRESHOLD + 1;
    const window = computeVirtualWindow(rowCount, 0, 220);
    expect(window.enabled).toBe(true);
    expect(window.start).toBe(0);
    expect(window.end).toBeLessThan(rowCount);
    const rendered = window.end - window.start;
    const total =
      window.paddingTop + rendered * ROW_HEIGHT_PX + window.paddingBottom;
    expect(total).toBe(rowCount * ROW_HEIGHT_PX);
  });

  it("moves the window with the scroll position and keeps overscan", () => {
    const rowCount = 1000;
    const viewport = 220;
    const scrolled = computeVirtualWindow(rowCount, 100 * ROW_HEIGHT_PX, viewport);
    const first = Math.floor(100);
    expect(scrolled.start).toBe(first - 8);
    expect(scrolled.end).toBeGreaterThanOrEqual(first + Math.ceil(viewport / ROW_HEIGHT_PX));
    expect(scrolled.paddingTop).toBe((first - 8) * ROW_HEIGHT_PX);
  });

  it("clamps nonsense scroll/viewport values instead of crashing", () => {
    const window = computeVirtualWindow(1000, Number.NaN, Number.POSITIVE_INFINITY);
    expect(window.enabled).toBe(true);
    expect(window.start).toBe(0);
    expect(window.paddingTop).toBe(0);
  });

  it("never returns an end below start at the bottom of the list", () => {
    const rowCount = 500;
    const window = computeVirtualWindow(rowCount, 50_000, 220);
    expect(window.start).toBeLessThanOrEqual(rowCount);
    expect(window.end).toBe(rowCount);
    expect(window.end).toBeGreaterThanOrEqual(window.start);
    expect(window.paddingBottom).toBe(0);
  });
});
