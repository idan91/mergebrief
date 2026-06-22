/**
 * Collapse concurrent calls for the same key into one underlying run — the
 * local-loop stand-in for a Postgres advisory lock (ADR 0006 #6). A rejected
 * run is not cached: the key is freed so the next call tries again.
 */
export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return function singleFlight(key: string, run: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = run().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
