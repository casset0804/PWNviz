export type PwndbgStatus = "not_found" | "detected" | "verified" | "load_failed";

export interface PlatformInfo {
  system: string;
  release: string;
  machine: string;
  architecture: string;
  is_x86_64: boolean;
  hostname: string;
}

export interface GdbPythonInfo {
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface GdbInfo {
  available: boolean;
  path: string | null;
  version: string | null;
  minimum_version: string;
  supported: boolean;
  supports_mi3: boolean;
  python: GdbPythonInfo;
  error: string | null;
  duration_ms: number | null;
}

export interface PwndbgInfo {
  status: PwndbgStatus;
  path: string | null;
  gdbinit: string | null;
  verified: boolean;
  version: string | null;
  detail: string | null;
  enabled: boolean;
}

export interface Capabilities {
  generated_at: string;
  service_version: string;
  platform: PlatformInfo;
  python: {
    backend_version: string;
    gdb_embedded_version: string | null;
  };
  gdb: GdbInfo;
  pwndbg: PwndbgInfo;
  samples: {
    directory: string;
    count: number;
  };
  ready: boolean;
  warnings: string[];
}

export interface SampleInfo {
  id: string;
  title: string;
  description: string | null;
  directory: string;
  source_file: string;
  binary_file: string;
  binary_exists: boolean;
  binary_size: number | null;
  binary_built_at: string | null;
  build_command: string[];
}

export interface SamplesResponse {
  samples_dir: string;
  count: number;
  samples: SampleInfo[];
}

export interface SampleSource {
  sample_id: string;
  source_file: string;
  language: string;
  content: string;
  line_count: number;
  truncated: boolean;
}
