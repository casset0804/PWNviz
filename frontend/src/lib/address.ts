/**
 * 64-bit address helpers. Every address stays a hex string in application state;
 * BigInt is used only for comparison/arithmetic, never Number.
 */

const HEX_ADDRESS = /^0x[0-9a-fA-F]+$/;

export function parseAddress(value: string | null | undefined): bigint | null {
  if (!value || !HEX_ADDRESS.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function formatAddress(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return `${negative ? "-" : ""}0x${magnitude.toString(16).padStart(16, "0")}`;
}

export function normalizeAddress(value: string | null | undefined): string | null {
  const parsed = parseAddress(value);
  return parsed === null ? null : formatAddress(parsed);
}

export function compareAddress(a: string | null, b: string | null): number {
  const left = parseAddress(a);
  const right = parseAddress(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function offsetWithinRow(rowAddress: string, target: string): number | null {
  const row = parseAddress(rowAddress);
  const address = parseAddress(target);
  if (row === null || address === null) return null;
  const offset = address - row;
  if (offset < 0n || offset > 7n) return null;
  return Number(offset);
}

export function addressInWindow(
  address: string | null,
  start: string | null,
  end: string | null,
): boolean {
  const parsed = parseAddress(address);
  const from = parseAddress(start);
  const to = parseAddress(end);
  if (parsed === null || from === null || to === null) return false;
  return parsed >= from && parsed < to;
}

export function addBytes(address: string, offset: number): string | null {
  const parsed = parseAddress(address);
  if (parsed === null) return null;
  return formatAddress(parsed + BigInt(offset));
}

export function signedHexDelta(
  after: string | null | undefined,
  before: string | null | undefined,
): string | null {
  const next = parseAddress(after);
  const previous = parseAddress(before);
  if (next === null || previous === null) return null;
  const delta = next - previous;
  if (delta === 0n) return "0x0";
  const sign = delta < 0n ? "-" : "+";
  return `${sign}0x${(delta < 0n ? -delta : delta).toString(16)}`;
}
