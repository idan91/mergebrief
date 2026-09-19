import {
  GenerationStatuses,
  type PrSummary,
  type PullsSession,
} from "../types";

const PULLS_POLL_MS = 10_000;
/**
 * The API does not cache a failed allowed-repo lookup, and each failing lookup
 * retries against GitHub, so an outage is polled slowly to spare the viewer's
 * token.
 */
const UNAVAILABLE_POLL_MS = 60_000;

/** `false`, not null: it is React Query's own off value for `refetchInterval`. */
type PullsRefetchInterval = number | false;

function isGenerationInFlight(row: PrSummary): boolean {
  const status = row.generation?.status;
  return (
    status === GenerationStatuses.PENDING ||
    status === GenerationStatuses.RUNNING
  );
}

/**
 * A home list refetches while one of its rows can still change its status
 * word. An unavailable list keeps refetching too: a 502 during a poll arrives
 * as data, and stopping there would strand the page on the degraded note.
 */
export function shouldPollPulls(session: PullsSession): boolean {
  if (session.kind === "logged-out") {
    return false;
  }
  if (session.kind === "unavailable") {
    return true;
  }
  return session.pulls.some(isGenerationInFlight);
}

export function getPullsRefetchInterval(
  session: PullsSession | undefined,
): PullsRefetchInterval {
  if (session === undefined || !shouldPollPulls(session)) {
    return false;
  }
  return session.kind === "unavailable" ? UNAVAILABLE_POLL_MS : PULLS_POLL_MS;
}
