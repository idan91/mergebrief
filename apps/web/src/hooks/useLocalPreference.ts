import { useCallback, useEffect, useState } from "react";

/**
 * Generic, SSR-safe persisted preference. Returns the default during server
 * render and on first client paint, then hydrates from localStorage on mount —
 * so it never causes a hydration mismatch. Writes are JSON-serialized.
 */
export function useLocalPreference<T>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(key);
    if (raw === null) return;
    try {
      setValue(JSON.parse(raw) as T);
    } catch {
      window.localStorage.removeItem(key);
    }
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable (private mode / quota) — keep in-memory value */
      }
    },
    [key],
  );

  return [value, set];
}
