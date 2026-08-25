import { PrState, type PullRequestLifecycle } from "persistence";

/** The `--state` lifecycle, used when no `gh` resolution is asked for. */
export function buildStaticLifecycle(
  state: "open" | "merged",
): PullRequestLifecycle {
  if (state === "open") {
    return { state: PrState.OPEN };
  }
  return { state: PrState.MERGED, closedAt: new Date(), purgeAfter: null };
}
