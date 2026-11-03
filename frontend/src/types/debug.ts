export type DebuggerState =
  | "IDLE"
  | "CREATED"
  | "INITIALIZING"
  | "READY"
  | "RUNNING"
  | "STOPPED"
  | "EXITED"
  | "ERROR"
  | "TERMINATED";

export type ActionName =
  | "launch"
  | "run"
  | "continue"
  | "interrupt"
  | "step_instruction"
  | "next_instruction"
  | "step"
  | "next"
  | "finish";

export interface SessionInfo {
  session_id: string;
  sample_id: string;
  state: DebuggerState | string;
  created_at: string;
  updated_at: string;
  snapshot_count: number;
  gdb_pid: number | null;
  inferior_pid: number | null;
  last_error: string | null;
  stop_reason: string | null;
}

export interface Frame {
  level: number;
  address: string | null;
  function: string | null;
  file: string | null;
  line: number | null;
}

export interface Instruction {
  address: string;
  bytes: string | null;
  mnemonic: string | null;
  operands: string | null;
  text: string | null;
  function: string | null;
}

export interface DisassemblyLine {
  address: string;
  text: string;
  is_current: boolean;
  function: string | null;
}

export interface StackRow {
  address: string;
  bytes: Array<string | null>;
  readable: boolean;
  qword_le: string | null;
  ascii: string | null;
  annotations: string[];
  changed_byte_offsets: number[];
}

export interface UnreadableRange {
  start: string;
  end: string;
}

export interface StackWindow {
  range_start: string | null;
  range_end: string | null;
  word_size: number;
  rows: StackRow[];
  unreadable_ranges: UnreadableRange[];
}

export interface MemoryChange {
  address: string;
  before: string | null;
  after: string | null;
}

export interface SnapshotDiff {
  previous_snapshot_id: number | null;
  changed_registers: string[];
  changed_bytes: MemoryChange[];
  window_changed: boolean;
}

export type VariableLocationKind =
  | "memory"
  | "register"
  | "optimized_out"
  | "unavailable"
  | "unknown";

export interface VariableNode {
  name: string;
  type: string;
  value: string | null;
  address: string | null;
  location_kind: VariableLocationKind;
  source: string;
  confidence: string;
  kind: string;
  is_argument: boolean;
  frame_level: number;
  children: VariableNode[];
  string_value: string | null;
  pointer_target: string | null;
  target_readable: boolean | null;
  target_bytes: string | null;
  target_string: string | null;
  target_source: string | null;
}

export interface Snapshot {
  session_id: string;
  snapshot_id: number;
  timestamp: string;
  state: string;
  stop_reason: string | null;
  architecture: string;
  endianness: string;
  pointer_bits: number;
  registers: Record<string, string | null>;
  frames: Frame[];
  instruction: Instruction | null;
  disassembly: DisassemblyLine[];
  stack: StackWindow;
  diff: SnapshotDiff;
  variables: VariableNode[];
  variables_available: boolean;
  warnings: string[];
}

export interface ActionResponse {
  session_id: string;
  state: DebuggerState | string;
  snapshot: Snapshot | null;
  message: string | null;
}

export interface SnapshotsResponse {
  session_id: string;
  count: number;
  snapshots: Snapshot[];
}

export interface Breakpoint {
  number: string | null;
  address: string | null;
  function: string | null;
  file: string | null;
  line: number | null;
  enabled: boolean;
}

export interface StreamEvent {
  type: string;
  session_id: string;
  payload?: Record<string, unknown>;
}
