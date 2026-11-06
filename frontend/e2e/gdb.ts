/**
 * Shared real-GDB session helpers for the visual suites.
 *
 * Everything drives the actual backend over REST (create session, launch to
 * main, MI single-step). Mock memory data is never used; if the backend is
 * unreachable the suites fail.
 */

import type { Page } from "@playwright/test";

export const API = (process.env.PWNVIZ_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export interface Frame {
  level: number;
  address: string | null;
  function: string | null;
  file: string | null;
  line: number | null;
}

export interface VariableNode {
  name: string;
  value: string | null;
  address: string | null;
  location_kind: string;
  frame_level: number;
}

export interface Snapshot {
  session_id: string;
  snapshot_id: number;
  state: string;
  registers: Record<string, string | null>;
  frames: Frame[];
  instruction: { address: string; text: string; mnemonic: string | null } | null;
  variables: VariableNode[];
  variables_available: boolean;
  stack: { range_start: string | null; range_end: string | null };
  diff: SnapshotDiff;
}

export interface SnapshotDiff {
  previous_snapshot_id: number | null;
  changed_registers: string[];
  changed_bytes: Array<{ address: string; before: string | null; after: string | null }>;
  window_changed: boolean;
}

export interface SessionInfo {
  session_id: string;
  state: string;
}

let activeSession: string | null = null;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} -> ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export async function createLaunchedSession(sampleId: string): Promise<SessionInfo> {
  const session = await api<SessionInfo>("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ sample_id: sampleId }),
  });
  activeSession = session.session_id;
  const launched = await api<{ session_id: string; state: string; snapshot: Snapshot | null }>(
    `/api/v1/sessions/${session.session_id}/launch`,
    { method: "POST" },
  );
  if (!launched.snapshot) throw new Error("launch returned no snapshot (backend misbehaving)");
  return session;
}

export async function stepOnce(sessionId: string): Promise<Snapshot> {
  const response = await api<{ snapshot: Snapshot | null }>(
    `/api/v1/sessions/${sessionId}/actions`,
    { method: "POST", body: JSON.stringify({ action: "step_instruction" }) },
  );
  if (!response.snapshot) throw new Error("step returned no snapshot");
  return response.snapshot;
}

export async function latestSnapshot(sessionId: string): Promise<Snapshot> {
  const response = await api<{ snapshots: Snapshot[] }>(`/api/v1/sessions/${sessionId}/snapshots`);
  const ordered = [...response.snapshots].sort((a, b) => a.snapshot_id - b.snapshot_id);
  const latest = ordered.at(-1);
  if (!latest) throw new Error("no snapshots recorded");
  return latest;
}

/** Step (real MI) until the predicate holds on the fresh snapshot. */
export async function stepUntil(
  sessionId: string,
  predicate: (snapshot: Snapshot) => boolean,
  maxSteps = 400,
): Promise<Snapshot> {
  let snapshot = await latestSnapshot(sessionId);
  for (let index = 0; index < maxSteps && !predicate(snapshot); index += 1) {
    snapshot = await stepOnce(sessionId);
    if (snapshot.state === "EXITED") break;
  }
  if (!predicate(snapshot)) {
    throw new Error(
      `checkpoint not reached within ${maxSteps} steps (stopped at ${snapshot.instruction?.text ?? "?"})`,
    );
  }
  return snapshot;
}

/** Presentation mode, zh-CN, animations off, actual zoom, booleans only. */
export async function preparePresentation(page: Page, projection = false): Promise<void> {
  await page.addInitScript(
    ([locale, isProjection]) => {
      window.localStorage.setItem("pwnviz.locale", locale);
      window.localStorage.setItem("pwnviz.mode", "presentation");
      window.localStorage.setItem("pwnviz.animations", "0");
      window.localStorage.setItem("pwnviz.stackZoom", "actual");
      window.localStorage.setItem("pwnviz.projection", isProjection ? "1" : "0");
      window.localStorage.setItem("pwnviz.showAllPointers", "0");
    },
    ["zh-CN", projection] as const,
  );
}

export async function openSession(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/?sessionId=${encodeURIComponent(sessionId)}`);
  await page
    .locator("[data-testid=stack-map-scroll]")
    .waitFor({ state: "visible", timeout: 15_000 });
}

/** Parse a GDB value string ("0x1e", "30", "-5") into a number (NaN if odd). */
export function parseGdbValue(value: string): number {
  const trimmed = value.trim();
  if (/^[-+]?0x[0-9a-fA-F]+$/.test(trimmed)) return Number.parseInt(trimmed, 16);
  if (/^[-+]?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  return Number.NaN;
}

export function addressInWindow(address: string | null, snapshot: Snapshot): boolean {
  if (!address) return false;
  const value = BigInt(address);
  const start = snapshot.stack.range_start ? BigInt(snapshot.stack.range_start) : null;
  const end = snapshot.stack.range_end ? BigInt(snapshot.stack.range_end) : null;
  return start !== null && end !== null && value >= start && value < end;
}

/** Best-effort cleanup of the session created by the current test. */
export async function cleanupSession(): Promise<void> {
  if (!activeSession) return;
  const id = activeSession;
  activeSession = null;
  await api(`/api/v1/sessions/${id}`, { method: "DELETE" }).catch(() => undefined);
}
