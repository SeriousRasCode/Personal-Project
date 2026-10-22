import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Page } from "./dispatch";
export function useCollection<T>(endpoint: string, pollMs = 0, enabled = true) {
  const [result, setResult] = useState<Page<T>>({ items: [] });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const serial = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const revision = ++serial.current;
    setLoading(true);
    setError("");
    try {
      const data = await api<Page<T>>(endpoint);
      if (revision === serial.current) setResult(data);
    } catch (failure) {
      if (revision === serial.current) setError((failure as Error).message);
    } finally {
      if (revision === serial.current) setLoading(false);
    }
  }, [endpoint, enabled]);
  useEffect(() => {
    setResult({ items: [] });
    void reload();
    const timer = pollMs
      ? window.setInterval(() => {
          if (!document.hidden) void reload();
        }, pollMs)
      : undefined;
    return () => {
      serial.current++;
      window.clearInterval(timer);
    };
  }, [reload, pollMs]);
  return { ...result, loading, error, reload };
}
