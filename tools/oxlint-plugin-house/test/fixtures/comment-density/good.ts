// The ceiling is the queue's visibility timeout: a retry scheduled past it
// runs against a job another worker has already picked up.

interface BackoffOptions {
  baseMs: number;
  ceilingMs: number;
  jitterRatio: number;
}

export function resolveBackoffMs(
  attempt: number,
  options: BackoffOptions,
): number {
  if (attempt < 1) return options.baseMs;

  const exponential = options.baseMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.ceilingMs);
  const jitter = capped * options.jitterRatio * Math.random();

  return Math.round(capped + jitter);
}

export function isRetryable(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts;
}

export function resolveTotalWaitMs(
  attempts: number,
  options: BackoffOptions,
): number {
  let total = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    total += resolveBackoffMs(attempt, options);
  }

  return total;
}
