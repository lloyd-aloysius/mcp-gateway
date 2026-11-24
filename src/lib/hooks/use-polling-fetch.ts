"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePollingFetch<T>(url: string | null, intervalMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as T;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    void refetch();
    timerRef.current = setInterval(() => void refetch(), intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [url, refetch, intervalMs]);

  return { data, loading, error, refetch };
}
