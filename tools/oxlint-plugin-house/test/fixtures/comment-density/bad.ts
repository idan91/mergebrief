// Backoff for the compare-files fetch.
// Every step below gets its own narration, which is the shape this rule
// exists to catch: the prose is longer than the code it sits above.

interface BackoffOptions {
  // The first delay, in milliseconds.
  baseMs: number;
  // The longest delay we will ever wait.
  ceilingMs: number;
  // Extra random wait, as a fraction of the delay.
  jitterRatio: number;
}

// Returns the delay to wait before one retry attempt.
export function resolveBackoffMs(
  attempt: number,
  options: BackoffOptions,
): number {
  // Guard a zero or negative attempt number.
  if (attempt < 1) return options.baseMs;

  // Double the base delay once per attempt.
  const exponential = options.baseMs * 2 ** (attempt - 1);

  // Never wait longer than the ceiling.
  const capped = Math.min(exponential, options.ceilingMs);

  // Add jitter so a fleet does not retry in lockstep.
  const jitter = capped * options.jitterRatio * Math.random();

  // Timers take whole milliseconds.
  const total = capped + jitter;

  // Hand the caller a rounded delay.
  return Math.round(total);
}

// Reports whether another attempt is worth making.
export function isRetryable(attempt: number, maxAttempts: number): boolean {
  // Stop once the caller's budget is spent.
  return attempt < maxAttempts;
}
