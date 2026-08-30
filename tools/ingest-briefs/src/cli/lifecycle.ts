import { PrStates, type PullRequestLifecycle } from "persistence";

/** The `--state` lifecycle, used when no `gh` resolution is asked for. */
export function buildStaticLifecycle(
  state: "open" | "merged",
): PullRequestLifecycle {
  if (state === "open") {
    return { state: PrStates.OPEN };
  }
  return { state: PrStates.MERGED, closedAt: new Date(), purgeAfter: null };
}
