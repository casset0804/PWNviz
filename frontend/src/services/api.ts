import type { Capabilities, SamplesResponse } from "../types/api";

// Empty base means "same origin": Vite proxies /api and /health to the WSL backend.
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
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

async function requestJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
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

  return (await response.json()) as T;
}

export function fetchCapabilities(verifyPwndbg = false): Promise<Capabilities> {
  return requestJson<Capabilities>(
    `/api/v1/capabilities${verifyPwndbg ? "?verify_pwndbg=true" : ""}`,
  );
}

export function fetchSamples(): Promise<SamplesResponse> {
  return requestJson<SamplesResponse>("/api/v1/samples");
}
