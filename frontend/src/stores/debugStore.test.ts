import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    deleteSession: vi.fn(),
  };
});

import { deleteSession } from "../services/api";
import type { SessionInfo } from "../types/debug";
import { useDebugStore } from "./debugStore";
const session: SessionInfo = {
  session_id: "sess_test",
  sample_id: "stack-basic",
  state: "STOPPED",
  created_at: "2026-11-03T00:00:00Z",
  updated_at: "2026-11-03T00:00:00Z",
  snapshot_count: 1,
  gdb_pid: 100,
  inferior_pid: 101,
  last_error: null,
  stop_reason: "end-stepping-range",
};

describe("debugStore terminate", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      history: { replaceState: vi.fn() },
      location: { pathname: "/" },
      setTimeout,
      clearTimeout,
      localStorage: { getItem: vi.fn(), setItem: vi.fn() },
    });
    vi.mocked(deleteSession).mockReset();
    useDebugStore.setState({
      session: { ...session },
      debuggerState: "STOPPED",
      snapshot: null,
      previousSnapshot: null,
      history: [],
      busy: false,
      error: null,
      log: [],
      streamStatus: "closed",
    });
  });

  it("keeps the session when DELETE fails so the user can retry", async () => {
    vi.mocked(deleteSession).mockRejectedValue(new Error("backend offline"));

    await useDebugStore.getState().terminate();

    const state = useDebugStore.getState();
    expect(state.session?.session_id).toBe(session.session_id);
    expect(state.busy).toBe(false);
    expect(state.error).toContain("terminate failed");
    expect(state.log.at(-1)?.level).toBe("error");
  });

  it("clears the session after DELETE succeeds", async () => {
    vi.mocked(deleteSession).mockResolvedValue(undefined);

    await useDebugStore.getState().terminate();

    const state = useDebugStore.getState();
    expect(state.session).toBeNull();
    expect(state.debuggerState).toBe("IDLE");
    expect(state.busy).toBe(false);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
