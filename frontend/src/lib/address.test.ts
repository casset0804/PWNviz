import { describe, expect, it } from "vitest";

import {
  addBytes,
  addressInWindow,
  compareAddress,
  formatAddress,
  normalizeAddress,
  offsetWithinRow,
  parseAddress,
  signedHexDelta,
} from "./address";

describe("address utilities", () => {
  it("keeps 64-bit values exact with BigInt", () => {
    const maximum = parseAddress("0xffffffffffffffff")!;
    expect(maximum).toBe(18446744073709551615n);
    expect(parseAddress("0x00007fffffffe270")).toBe(140737488347760n);
    // 2^64-1 is not exactly representable as a JS Number; BigInt is.
    expect(BigInt(Number(maximum))).not.toBe(maximum);
  });

  it("formats canonical 16-digit hex strings", () => {
    expect(formatAddress(0x401167n)).toBe("0x0000000000401167");
    expect(normalizeAddress("0x401167")).toBe("0x0000000000401167");
    expect(normalizeAddress("not-an-address")).toBeNull();
  });

  it("compares addresses without Number conversion", () => {
    expect(compareAddress("0x00007fffffffe270", "0x00007fffffffe271")).toBe(-1);
    expect(compareAddress("0x00007fffffffe271", "0x00007fffffffe270")).toBe(1);
    expect(compareAddress("0x00007fffffffe270", "0x00007fffffffe270")).toBe(0);
  });

  it("finds byte offsets inside a row", () => {
    expect(offsetWithinRow("0x00007fffffffe270", "0x00007fffffffe274")).toBe(4);
    expect(offsetWithinRow("0x00007fffffffe270", "0x00007fffffffe278")).toBeNull();
  });

  it("adds offsets and checks window membership", () => {
    expect(addBytes("0x00007fffffffe270", 4)).toBe("0x00007fffffffe274");
    expect(
      addressInWindow(
        "0x00007fffffffe274",
        "0x00007fffffffe1f0",
        "0x00007fffffffe3f0",
      ),
    ).toBe(true);
    expect(
      addressInWindow(
        "0x00007fffffffe4f0",
        "0x00007fffffffe1f0",
        "0x00007fffffffe3f0",
      ),
    ).toBe(false);
  });

  it("computes signed RSP/RBP deltas", () => {
    expect(signedHexDelta("0x00007fffffffe260", "0x00007fffffffe270")).toBe(
      "-0x10",
    );
    expect(signedHexDelta("0x00007fffffffe280", "0x00007fffffffe270")).toBe(
      "+0x10",
    );
    expect(signedHexDelta("0x00007fffffffe270", "0x00007fffffffe270")).toBe("0x0");
  });
});
