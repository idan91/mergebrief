// Retry tuning for every Octokit this package constructs (BRIEF-3 Part 4).
// octokit's umbrella client bundles @octokit/plugin-retry, whose DEFAULT
// `doNotRetry` list is [400, 401, 403, 404, 410, 422, 451] — 406 is absent,
// so by default a 406 is retried three times with backoff. GitHub's 406 on a
// diff/compare fetch means "diff too large to render" (>300 files / >20k
// lines): PERMANENT for that span, so every retry is pure waste — worse on
// the worker, where it stalls a minutes-long generation job on a span that
// can never succeed. Supplying `doNotRetry` REPLACES the plugin's default
// list, so the defaults are repeated here alongside 406.
export const DO_NOT_RETRY_STATUSES = [400, 401, 403, 404, 406, 410, 422, 451] as const;

/** The `retry` options block passed at client construction. */
export function retryOptions(): { doNotRetry: number[] } {
  return { doNotRetry: [...DO_NOT_RETRY_STATUSES] };
}
