import { create } from "zustand";

import * as api from "../services/api";
import { ApiError } from "../services/api";
import type {
  ActionName,
  DebuggerState,
  SessionInfo,
  Snapshot,
  StreamEvent,
} from "../types/debug";

export type BottomTab = "environment" | "memory" | "diff" | "explanation" | "log";
export type StreamStatus = "closed" | "connecting" | "open" | "reconnecting";
export type LogLevel = "info" | "event" | "error";

export interface LogEntry {
  id: number;
  at: string;
  level: LogLevel;
  message: string;
}

export interface ScrollTarget {
  address: string;
  nonce: number;
}

interface DebugStore {
  selectedSampleId: string | null;
  session: SessionInfo | null;
  debuggerState: DebuggerState;
  snapshot: Snapshot | null;
  previousSnapshot: Snapshot | null;
  history: Snapshot[];
  selectedByteAddress: string | null;
  selectedInstructionAddress: string | null;
  scrollTarget: ScrollTarget | null;
  animationsEnabled: boolean;
  streamStatus: StreamStatus;
  busy: boolean;
  error: string | null;
  bottomTab: BottomTab;
  log: LogEntry[];

  setSelectedSampleId: (sampleId: string | null) => void;
  setBottomTab: (tab: BottomTab) => void;
  dismissError: () => void;
  toggleAnimations: () => void;
  selectByte: (address: string) => void;
  selectInstruction: (address: string) => void;
  requestScroll: (address: string) => void;
  appendLog: (level: LogLevel, message: string) => void;

  startSession: () => Promise<void>;
  launchExisting: () => Promise<void>;
  attachSession: (sessionId: string) => Promise<void>;
  continueExecution: () => Promise<void>;
  pause: () => Promise<void>;
  stepInstruction: () => Promise<void>;
  nextInstruction: () => Promise<void>;
  stepSource: () => Promise<void>;
  nextSource: () => Promise<void>;
  finish: () => Promise<void>;
  terminate: () => Promise<void>;
}

const KNOWN_STATES: ReadonlySet<string> = new Set([
  "IDLE",
  "CREATED",
  "INITIALIZING",
  "READY",
  "RUNNING",
  "STOPPED",
  "EXITED",
  "ERROR",
  "TERMINATED",
]);

function normalizeState(value: string | null | undefined): DebuggerState {
  const upper = (value ?? "").toUpperCase();
  return KNOWN_STATES.has(upper) ? (upper as DebuggerState) : "IDLE";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function logNow(level: LogLevel, message: string): LogEntry {
  logSequence += 1;
  return { id: logSequence, at: new Date().toISOString(), level, message };
}

function readAnimationPreference(): boolean {
  try {
    return window.localStorage.getItem("pwnviz.animations") !== "0";
  } catch {
    return true;
  }
}

let logSequence = 0;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let intentionalClose = false;
let reconnectAttempts = 0;

export const useDebugStore = create<DebugStore>()((set, get) => ({
  selectedSampleId: null,
  session: null,
  debuggerState: "IDLE",
  snapshot: null,
  previousSnapshot: null,
  history: [],
  selectedByteAddress: null,
  selectedInstructionAddress: null,
  scrollTarget: null,
  animationsEnabled: readAnimationPreference(),
  streamStatus: "closed",
  busy: false,
  error: null,
  bottomTab: "environment",
  log: [],

  setSelectedSampleId: (selectedSampleId) => {
    if (get().session) return;
    set({ selectedSampleId });
  },

  setBottomTab: (bottomTab) => set({ bottomTab }),

  dismissError: () => set({ error: null }),

  toggleAnimations: () => {
    const animationsEnabled = !get().animationsEnabled;
    set({ animationsEnabled });
    try {
      window.localStorage.setItem("pwnviz.animations", animationsEnabled ? "1" : "0");
    } catch {
      // Local storage can be unavailable in private/embedded contexts.
    }
  },

  selectByte: (address) =>
    set({
      selectedByteAddress: address,
      selectedInstructionAddress: null,
      bottomTab: "memory",
    }),

  selectInstruction: (address) =>
    set({
      selectedInstructionAddress: address,
      selectedByteAddress: null,
    }),

  requestScroll: (address) =>
    set({ scrollTarget: { address, nonce: Date.now() } }),

  appendLog: (level, message) =>
    set((state) => ({
      log: [...state.log, logNow(level, message)].slice(-200),
    })),

  startSession: async () => {
    if (get().busy || get().session) return;
    const sampleId = get().selectedSampleId;
    if (!sampleId) {
      set({ error: "Select a teaching sample before launching." });
      return;
    }

    set({ busy: true, error: null, bottomTab: "memory" });
    get().appendLog("info", `creating session for ${sampleId}`);
    closeStream(true);
    try {
      const session = await api.createSession({ sample_id: sampleId });
      set({
        session,
        debuggerState: normalizeState(session.state),
        snapshot: null,
        previousSnapshot: null,
        history: [],
        selectedByteAddress: null,
        selectedInstructionAddress: null,
        scrollTarget: null,
      });
      window.history.replaceState(null, "", `?sessionId=${encodeURIComponent(session.session_id)}`);
      openStream(session.session_id, true);

      get().appendLog("info", `launching ${session.session_id}`);
      const launched = await api.launchSession(session.session_id);
      applyActionResponse(launched);
      const info = await api.fetchSession(session.session_id).catch(() => null);
      if (info && get().session?.session_id === session.session_id) {
        set({ session: info, debuggerState: normalizeState(info.state) });
      }
    } catch (error) {
      set({ error: errorMessage(error) });
      get().appendLog("error", errorMessage(error));
      await refreshSessionSilently();
    } finally {
      set({ busy: false });
    }
  },

  launchExisting: async () => {
    const session = get().session;
    if (!session) {
      await get().startSession();
      return;
    }
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      const launched = await api.launchSession(session.session_id);
      applyActionResponse(launched);
      const info = await api.fetchSession(session.session_id).catch(() => null);
      if (info) set({ session: info });
    } catch (error) {
      set({ error: errorMessage(error) });
      get().appendLog("error", errorMessage(error));
      await refreshSessionSilently();
    } finally {
      set({ busy: false });
    }
  },

  attachSession: async (sessionId) => {
    if (get().busy) return;
    set({ busy: true, error: null });
    closeStream(true);
    try {
      const [session, snapshots] = await Promise.all([
        api.fetchSession(sessionId),
        api.fetchSnapshots(sessionId),
      ]);
      const ordered = [...snapshots.snapshots].sort(
        (left, right) => left.snapshot_id - right.snapshot_id,
      );
      const latest = ordered.at(-1) ?? null;
      const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
      set({
        session,
        debuggerState: normalizeState(session.state),
        snapshot: latest,
        previousSnapshot: previous,
        history: ordered.slice(-200),
        selectedByteAddress: null,
        selectedInstructionAddress: null,
        scrollTarget: null,
        bottomTab: "memory",
      });
      window.history.replaceState(
        null,
        "",
        `?sessionId=${encodeURIComponent(sessionId)}`,
      );
      openStream(sessionId, true);
      get().appendLog("info", `attached to ${sessionId}`);
    } catch (error) {
      set({ error: errorMessage(error), session: null, debuggerState: "IDLE" });
      get().appendLog("error", errorMessage(error));
      closeStream(true);
    } finally {
      set({ busy: false });
    }
  },

  continueExecution: () => runAction("continue"),
  pause: () => runAction("interrupt"),
  stepInstruction: () => runAction("step_instruction"),
  nextInstruction: () => runAction("next_instruction"),
  stepSource: () => runAction("step"),
  nextSource: () => runAction("next"),
  finish: () => runAction("finish"),

  terminate: async () => {
    const session = get().session;
    if (!session) return;
    if (get().busy) return;
    set({ busy: true });
    try {
      await api.deleteSession(session.session_id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Already gone on the backend; fall through and clear local state.
      } else {
        const message = `terminate failed: ${errorMessage(error)}`;
        set({ error: message, busy: false });
        get().appendLog("error", message);
        // Keep the session and WebSocket so the user can retry DELETE. Clearing
        // local state here would hide a still-running GDB/inferior.
        return;
      }
    }

    closeStream(true);
    set({
      session: null,
      debuggerState: "IDLE",
      snapshot: null,
      previousSnapshot: null,
      history: [],
      selectedByteAddress: null,
      selectedInstructionAddress: null,
      scrollTarget: null,
      streamStatus: "closed",
      busy: false,
      error: null,
      bottomTab: "environment",
    });
    window.history.replaceState(null, "", window.location.pathname);
    get().appendLog("info", "session terminated");
  },
}));

async function runAction(action: ActionName): Promise<void> {
  const current = useDebugStore.getState();
  if (!current.session || current.busy) return;

  useDebugStore.setState({ busy: true, error: null });
  current.appendLog("info", `action ${action}`);
  try {
    const response = await api.sendAction(current.session.session_id, action);
    applyActionResponse(response);
    const info = await api.fetchSession(current.session.session_id).catch(() => null);
    const state = useDebugStore.getState();
    if (info && state.session?.session_id === current.session.session_id) {
      useDebugStore.setState({ session: info });
    }
  } catch (error) {
    const message = errorMessage(error);
    useDebugStore.setState({ error: message });
    useDebugStore.getState().appendLog("error", message);
    await refreshSessionSilently();
  } finally {
    useDebugStore.setState({ busy: false });
  }
}

function applyActionResponse(response: {
  session_id: string;
  state: string;
  snapshot: Snapshot | null;
}): void {
  const current = useDebugStore.getState();
  if (!current.session || current.session.session_id !== response.session_id) return;
  const nextState = normalizeState(response.state);
  useDebugStore.setState({
    debuggerState: nextState,
    session: { ...current.session, state: nextState },
  });
  if (response.snapshot) {
    applySnapshot(response.snapshot);
  }
}

function applySnapshot(snapshot: Snapshot): void {
  const current = useDebugStore.getState();
  if (!current.session || current.session.session_id !== snapshot.session_id) return;
  if (current.snapshot && snapshot.snapshot_id <= current.snapshot.snapshot_id) {
    return;
  }
  const history = [...current.history, snapshot].slice(-200);
  useDebugStore.setState({
    snapshot,
    previousSnapshot: current.snapshot,
    history,
    debuggerState: "STOPPED",
    error: null,
    session: current.session
      ? {
          ...current.session,
          state: "STOPPED",
          snapshot_count: history.length,
          stop_reason: snapshot.stop_reason,
        }
      : current.session,
  });
}

async function refreshSessionSilently(): Promise<void> {
  const session = useDebugStore.getState().session;
  if (!session) return;
  try {
    const info = await api.fetchSession(session.session_id);
    const current = useDebugStore.getState();
    if (!current.session || current.session.session_id !== info.session_id) return;
    useDebugStore.setState({
      session: info,
      debuggerState: normalizeState(info.state),
    });
  } catch {
    // The stream reconnect loop handles transient backend outages.
  }
}

async function hydrateHistory(sessionId: string): Promise<void> {
  try {
    const snapshots = await api.fetchSnapshots(sessionId);
    const current = useDebugStore.getState();
    if (!current.session || current.session.session_id !== sessionId) return;
    const merged = new Map<number, Snapshot>();
    for (const snapshot of current.history) merged.set(snapshot.snapshot_id, snapshot);
    for (const snapshot of snapshots.snapshots) merged.set(snapshot.snapshot_id, snapshot);
    const ordered = [...merged.values()].sort(
      (left, right) => left.snapshot_id - right.snapshot_id,
    );
    const latest = ordered.at(-1) ?? null;
    const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
    useDebugStore.setState({
      history: ordered.slice(-200),
      snapshot: latest,
      previousSnapshot: previous,
    });
  } catch {
    // History hydration is best-effort; live events still drive the UI.
  }
}

function handleStreamMessage(sessionId: string, raw: string): void {
  let event: StreamEvent;
  try {
    event = JSON.parse(raw) as StreamEvent;
  } catch {
    return;
  }
  if (event.session_id && event.session_id !== sessionId) {
    return;
  }

  const payload = event.payload ?? {};
  if (event.type === "snapshot") {
    const snapshot = payload as unknown as Snapshot;
    if (typeof snapshot.snapshot_id !== "number" || !snapshot.stack) return;
    applySnapshot(snapshot);
    return;
  }

  if (event.type === "session.state") {
    const nextState = normalizeState(
      typeof payload.state === "string" ? payload.state : undefined,
    );
    useDebugStore.setState((state) => ({
      debuggerState: nextState,
      session: state.session
        ? {
            ...state.session,
            state: nextState,
            stop_reason:
              typeof payload.stop_reason === "string"
                ? payload.stop_reason
                : state.session.stop_reason,
            last_error:
              typeof payload.last_error === "string"
                ? payload.last_error
                : state.session.last_error,
          }
        : state.session,
    }));
    useDebugStore
      .getState()
      .appendLog("event", `session.state ${nextState}`);
    return;
  }

  if (event.type === "debugger.error") {
    const message =
      typeof payload.message === "string" ? payload.message : "debugger error";
    useDebugStore.setState({ error: message });
    useDebugStore.getState().appendLog("error", message);
    return;
  }

  if (event.type === "session.terminated") {
    closeStream(true);
    useDebugStore.setState((state) => ({
      debuggerState: "TERMINATED",
      session: state.session
        ? { ...state.session, state: "TERMINATED" }
        : state.session,
    }));
    useDebugStore.getState().appendLog("event", "session.terminated");
  }
}

function openStream(sessionId: string, resetAttempts = false): void {
  closeStream(true);
  if (resetAttempts) reconnectAttempts = 0;
  intentionalClose = false;
  useDebugStore.setState({ streamStatus: "connecting" });

  let nextSocket: WebSocket;
  try {
    nextSocket = new WebSocket(api.sessionStreamUrl(sessionId));
  } catch (error) {
    useDebugStore.setState({ streamStatus: "closed", error: errorMessage(error) });
    scheduleReconnect(sessionId);
    return;
  }

  socket = nextSocket;
  nextSocket.onopen = () => {
    if (socket !== nextSocket) return;
    reconnectAttempts = 0;
    useDebugStore.setState({ streamStatus: "open" });
    void hydrateHistory(sessionId);
  };
  nextSocket.onmessage = (event) => {
    handleStreamMessage(sessionId, String(event.data));
  };
  nextSocket.onclose = () => {
    if (socket !== nextSocket) return;
    socket = null;
    if (intentionalClose) {
      useDebugStore.setState({ streamStatus: "closed" });
      return;
    }
    const current = useDebugStore.getState();
    if (
      !current.session ||
      current.session.session_id !== sessionId ||
      current.debuggerState === "TERMINATED"
    ) {
      useDebugStore.setState({ streamStatus: "closed" });
      return;
    }
    scheduleReconnect(sessionId);
  };
  nextSocket.onerror = () => {
    // The close handler owns reconnection and status transitions.
  };
}

function scheduleReconnect(sessionId: string): void {
  if (reconnectTimer !== null) return;
  if (reconnectAttempts >= 5) {
    useDebugStore.setState({ streamStatus: "closed" });
    useDebugStore
      .getState()
      .appendLog("error", "live stream unavailable after 5 reconnect attempts");
    return;
  }
  reconnectAttempts += 1;
  useDebugStore.setState({ streamStatus: "reconnecting" });
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    const current = useDebugStore.getState();
    if (
      !current.session ||
      current.session.session_id !== sessionId ||
      current.debuggerState === "TERMINATED"
    ) {
      return;
    }
    openStream(sessionId);
  }, 1000);
}

function closeStream(intentional: boolean): void {
  intentionalClose = intentional;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const current = socket;
  socket = null;
  if (current) {
    try {
      current.close();
    } catch {
      // Closing an already closed socket is harmless.
    }
  }
  if (intentional) {
    useDebugStore.setState({ streamStatus: "closed" });
  }
}
