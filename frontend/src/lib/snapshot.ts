import {
  addBytes,
  normalizeAddress,
  offsetWithinRow,
  parseAddress,
} from "./address";
import type {
  MemoryChange,
  Snapshot,
  StackRow,
} from "../types/debug";

export interface RowMarker {
  kind: "RSP" | "RBP";
  offset: number;
}

export interface SelectedCell {
  row: StackRow;
  offset: number;
  address: string;
  byte: string | null;
}

export function changedBytesMap(snapshot: Snapshot | null): Map<string, MemoryChange> {
  const map = new Map<string, MemoryChange>();
  if (!snapshot) return map;
  for (const change of snapshot.diff.changed_bytes) {
    const normalized = normalizeAddress(change.address);
    if (normalized) map.set(normalized, change);
  }
  return map;
}

export function markersForRow(
  row: StackRow,
  rsp: string | null,
  rbp: string | null,
): RowMarker[] {
  const markers: RowMarker[] = [];
  const rspOffset = rsp ? offsetWithinRow(row.address, rsp) : null;
  if (rspOffset !== null) markers.push({ kind: "RSP", offset: rspOffset });
  const rbpOffset = rbp ? offsetWithinRow(row.address, rbp) : null;
  if (rbpOffset !== null) markers.push({ kind: "RBP", offset: rbpOffset });
  return markers;
}

export function findCell(
  snapshot: Snapshot | null,
  address: string | null,
): SelectedCell | null {
  if (!snapshot || !address) return null;
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  for (const row of snapshot.stack.rows) {
    const offset = offsetWithinRow(row.address, normalized);
    if (offset !== null) {
      return {
        row,
        offset,
        address: addBytes(row.address, offset) ?? normalized,
        byte: row.bytes[offset] ?? null,
      };
    }
  }
  return null;
}

export function findRowByAddress(
  snapshot: Snapshot | null,
  address: string | null,
): StackRow | null {
  return findCell(snapshot, address)?.row ?? null;
}

export function previousRegisterValue(
  snapshot: Snapshot | null,
  previousSnapshot: Snapshot | null,
  register: string,
): string | null {
  if (!snapshot) return null;
  if (
    previousSnapshot &&
    (snapshot.diff.previous_snapshot_id === null ||
      previousSnapshot.snapshot_id === snapshot.diff.previous_snapshot_id)
  ) {
    return previousSnapshot.registers[register] ?? null;
  }
  return null;
}

export function isAddressInWindow(snapshot: Snapshot | null, address: string | null): boolean {
  if (!snapshot || !address) return false;
  const target = parseAddress(address);
  const start = parseAddress(snapshot.stack.range_start);
  const end = parseAddress(snapshot.stack.range_end);
  if (target === null || start === null || end === null) return false;
  return target >= start && target < end;
}
