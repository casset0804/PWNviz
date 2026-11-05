import { useEffect, useRef, useState } from "react";
import { translate } from "../i18n";
import { ApiError, fetchSamples } from "../services/api";
import type { SampleInfo } from "../types/api";

interface UseSamplesResult {
  samples: SampleInfo[];
  samplesDir: string | null;
  loading: boolean;
  error: string | null;
}

export function useSamples(): UseSamplesResult {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [samplesDir, setSamplesDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const response = await fetchSamples();
        if (!mounted.current) return;
        setSamples(response.samples);
        setSamplesDir(response.samples_dir);
        setError(null);
      } catch (cause) {
        if (!mounted.current) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : translate("listSamplesFailed", {}, "errors"),
        );
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  return { samples, samplesDir, loading, error };
}
