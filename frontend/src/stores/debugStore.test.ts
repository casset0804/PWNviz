import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    deleteSession: vi.fn(),
  };
});

import { deleteSession } from "../services/api";
import type { SessionInfo, VariableNode } from "../types/debug";
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

describe("debugStore terminate", () => {  beforeEach(() => {
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

describe("debugStore pointer jump", () => {
  it("selects the bounded target and exposes its readable bytes", () => {
    const node: VariableNode = {
      name: "ptr",
      type: "int *",
      value: "0x00007fffffffe234",
      address: "0x00007fffffffe238",
      location_kind: "memory",
      source: "dwarf",
      confidence: "debug-info",
      kind: "pointer",
      is_argument: false,
      frame_level: 0,
      children: [],
      string_value: null,
      pointer_target: "0x00007fffffffe234",
      target_readable: true,
      target_bytes: "2a000000",
      target_string: null,
      target_source: "gdb-memory",
    };
    useDebugStore.setState({ pointerTarget: null });

    useDebugStore.getState().jumpToPointer(node);

    const state = useDebugStore.getState();
    expect(state.pointerTarget?.variableName).toBe("ptr");
    expect(state.pointerTarget?.address).toBe(node.pointer_target);
    expect(state.pointerTarget?.readable).toBe(true);
    expect(state.selectedByteAddress).toBe(node.pointer_target);
    expect(state.bottomTab).toBe("memory");
    expect(state.scrollTarget?.address).toBe(node.pointer_target);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
