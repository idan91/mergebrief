export type SingleFlight<T> = (
  key: string,
  run: () => Promise<T>,
) => Promise<T>;

/**
 * Collapse concurrent runs for the same key into one flight. Joining is
 * access-safe for the generate op: every caller proved it can READ the PR via
 * its own head fetch before reaching the flight, and the shared result is a
 * briefId, not viewer state. A rejected run frees the key for retry.
 */
export function createSingleFlight<T>(): SingleFlight<T> {
  const inFlight = new Map<string, Promise<T>>();
  return (key, run) => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = run().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
