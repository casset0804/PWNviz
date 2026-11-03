import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchCapabilities } from "../services/api";
import type { Capabilities } from "../types/api";

interface UseCapabilitiesResult {
  data: Capabilities | null;
  error: string | null;
  loading: boolean;
  verifying: boolean;
  refresh: (options?: { verifyPwndbg?: boolean }) => void;
}

/**
 * Fetch the backend's real capability report. `refresh({ verifyPwndbg: true })`
 * asks the backend to actually load pwndbg into a throwaway GDB process.
 */
export function useCapabilities(): UseCapabilitiesResult {
  const [data, setData] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const mounted = useRef(true);

  const run = useCallback(async (verifyPwndbg: boolean) => {
    if (verifyPwndbg) {
      setVerifying(true);
    } else {
      setLoading(true);
    }
    try {
      const next = await fetchCapabilities(verifyPwndbg);
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (!mounted.current) return;
      const message =
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Unknown error while probing the backend";
      setError(message);
    } finally {
      if (mounted.current) {
        setLoading(false);
        setVerifying(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void run(false);
    return () => {
      mounted.current = false;
    };
  }, [run]);

  return {
    data,
    error,
    loading,
    verifying,
    refresh: (options) => {
      void run(options?.verifyPwndbg ?? false);
    },
  };
}
