// Retry tuning for every Octokit this package constructs. GitHub's 406 on a
// diff/compare fetch means "diff too large to render" — permanent for that
// span, so retrying is pure waste, but it is absent from the retry plugin's
// default `doNotRetry` list. Supplying `doNotRetry` REPLACES that default
// list, so the defaults are repeated here alongside 406.
export const DO_NOT_RETRY_STATUSES = [
  400, 401, 403, 404, 406, 410, 422, 451,
] as const;

/** The `retry` options block passed at client construction. */
export function retryOptions(): { doNotRetry: number[] } {
  return { doNotRetry: [...DO_NOT_RETRY_STATUSES] };
}
