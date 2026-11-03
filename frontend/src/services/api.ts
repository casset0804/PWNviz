import type { Capabilities, SamplesResponse } from "../types/api";
import type {
  ActionName,
  ActionResponse,
  SessionInfo,
  SnapshotsResponse,
} from "../types/debug";

// Empty base means "same origin": Vite proxies /api and /health to the WSL backend.
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const WS_BASE = (import.meta.env.VITE_WS_BASE ?? "").replace(/\/$/, "");

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      `Backend unreachable at ${API_BASE || window.location.origin} (${reason}). ` +
        "Start it with scripts/dev_backend.sh inside WSL.",
      0,
      "backend_unreachable",
    );
  }

  if (!response.ok) {
    let payload: ErrorEnvelope | null = null;
    try {
      payload = (await response.json()) as ErrorEnvelope;
    } catch {
      payload = null;
    }
    throw new ApiError(
      payload?.error?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      payload?.error?.code ?? null,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function fetchCapabilities(verifyPwndbg = false): Promise<Capabilities> {
  return request<Capabilities>(
    `/api/v1/capabilities${verifyPwndbg ? "?verify_pwndbg=true" : ""}`,
  );
}

export function fetchSamples(): Promise<SamplesResponse> {
  return request<SamplesResponse>("/api/v1/samples");
}

export function createSession(input: {
  sample_id: string;
  stop_at?: string;
  load_pwndbg?: boolean;
}): Promise<SessionInfo> {
  return request<SessionInfo>("/api/v1/sessions", {
    method: "POST",
    body: input,
    timeoutMs: 30_000,
  });
}

export function fetchSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
}

export function launchSession(sessionId: string): Promise<ActionResponse> {
  return request<ActionResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/launch`,
    { method: "POST", timeoutMs: 90_000 },
  );
}

export function sendAction(
  sessionId: string,
  action: ActionName,
): Promise<ActionResponse> {
  return request<ActionResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/actions`,
    {
      method: "POST",
      body: { action },
      timeoutMs: 60_000,
    },
  );
}

export function fetchSnapshots(sessionId: string): Promise<SnapshotsResponse> {
  return request<SnapshotsResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/snapshots`,
  );
}

export function deleteSession(sessionId: string): Promise<void> {
  return request<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

export function sessionStreamUrl(sessionId: string): string {
  const path = `/api/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
  if (WS_BASE) {
    return `${WS_BASE}${path}`;
  }
  if (API_BASE.startsWith("http://") || API_BASE.startsWith("https://")) {
    return `${API_BASE.replace(/^http/, "ws")}${path}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
