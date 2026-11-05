import { useEffect, useState } from "react";

import { fetchSampleSource } from "../services/api";
import type { SampleSource } from "../types/api";

interface SampleSourceState {
  source: SampleSource | null;
  loading: boolean;
  error: string | null;
}

const IDLE: SampleSourceState = { source: null, loading: false, error: null };

/**
 * Fetch the real source text for the selected sample.
 *
 * The backend owns path resolution; this hook only knows a sample id. A failed
 * request is a first-class state (older backends do not expose the endpoint),
 * never replaced with invented source text.
 */
export function useSampleSource(sampleId: string | null): SampleSourceState {
  const [state, setState] = useState<SampleSourceState>(IDLE);

  useEffect(() => {
    if (!sampleId) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState({ source: null, loading: true, error: null });
    fetchSampleSource(sampleId)
      .then((source) => {
        if (cancelled) return;
        setState({ source, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          source: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  return state;
}
