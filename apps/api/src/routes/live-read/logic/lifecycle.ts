import type { PullRequestLifecycle } from "persistence";
import { PrStates } from "types/pull-requests";

/** The slice of a GitHub read the lifecycle comes from. */
export interface LifecycleFacts {
  /** GitHub PR state (`open` / `closed`). */
  readonly state: string;
  readonly merged: boolean;
  readonly closedAt: Date | null;
}

/**
 * The PR lifecycle as a live GitHub read reports it. Terminal states are
 * first-class here, unlike the webhook door: briefing a merged PR is the url
 * door's primary use.
 */
export function deriveLifecycle(
  facts: LifecycleFacts,
  now: Date,
): PullRequestLifecycle {
  if (facts.merged) {
    return {
      state: PrStates.MERGED,
      closedAt: facts.closedAt ?? now,
      purgeAfter: null,
    };
  }
  if (facts.state === "closed") {
    return {
      state: PrStates.CLOSED,
      closedAt: facts.closedAt ?? now,
      purgeAfter: null,
    };
  }
  return { state: PrStates.OPEN };
}
