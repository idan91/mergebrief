/** Reads the global fetch per call, not at construction, so a stub still answers. */
export function createTimedFetch(timeoutMs: number): typeof fetch {
  return function fetchWithTimeout(input, init) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (init?.signal) {
      signals.push(init.signal);
    }
    return globalThis.fetch(input, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  };
}
