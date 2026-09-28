import { HttpStatuses } from "types/http";
// Retry tuning for every Octokit this package constructs. GitHub's 406 on a
// diff/compare fetch means "diff too large to render", permanent for that
// span, so retrying is pure waste, but it is absent from the retry plugin's
// default `doNotRetry` list. Supplying `doNotRetry` REPLACES that default
// list, so the defaults are repeated here alongside 406.
export const DO_NOT_RETRY_STATUSES = [
  HttpStatuses.BAD_REQUEST,
  HttpStatuses.UNAUTHORIZED,
  HttpStatuses.FORBIDDEN,
  HttpStatuses.NOT_FOUND,
  HttpStatuses.NOT_ACCEPTABLE,
  HttpStatuses.GONE,
  HttpStatuses.UNPROCESSABLE_CONTENT,
  HttpStatuses.UNAVAILABLE_FOR_LEGAL_REASONS,
] as const;

/** The `retry` options block passed at client construction. */
export function retryOptions(): { doNotRetry: number[] } {
  return { doNotRetry: [...DO_NOT_RETRY_STATUSES] };
}
