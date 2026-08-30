// A url-box PR may have no App installation, so GitHub delivers no webhook
// for it: when a drain finds the head has moved, nothing else will ever
// schedule the head it found. This module re-enqueues that head on the same
// grant before the stale run stands down.
import type { PullRequestInfo } from "github";
import {
  createIngestRoutines,
  PrStates,
  type AppDatabase,
  type GrantRowId,
  type PullRequestLifecycle,
  type PullRequestUpsertInput,
  type RepoId,
  type ScopeContext,
} from "persistence";
import type { Logger } from "logging";
import type { Mutable } from "types";

// Matches the paste door's window: coalesces a push burst into one follow-up
// instead of chasing every intermediate head.
const FOLLOW_UP_DEBOUNCE_SECONDS = 10;

export interface OwnerHeadFollowUpInput {
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly grantId: GrantRowId;
  /** The live read that observed the newer head. */
  readonly info: PullRequestInfo;
  readonly log: Logger;
}

/** The lifecycle the live read reports; the url-box world briefs terminal PRs. */
function buildLifecycle(info: PullRequestInfo): PullRequestLifecycle {
  if (info.merged) {
    return {
      state: PrStates.MERGED,
      closedAt: info.closedAt ?? new Date(),
      purgeAfter: null,
    };
  }
  if (info.state === "closed") {
    return {
      state: PrStates.CLOSED,
      closedAt: info.closedAt ?? new Date(),
      purgeAfter: null,
    };
  }
  return { state: PrStates.OPEN };
}

export async function enqueueOwnerHeadFollowUp(
  handle: AppDatabase,
  ctx: ScopeContext,
  input: OwnerHeadFollowUpInput,
): Promise<void> {
  const { info } = input;
  const pullRequest: Mutable<PullRequestUpsertInput> = {
    repoId: input.repoId,
    prNumber: input.prNumber,
    repoSlug: info.repoFullName,
    title: info.title,
    baseSha: info.baseSha,
    draft: info.draft,
    ...buildLifecycle(info),
  };
  if (info.authorLogin !== null) {
    pullRequest.authorLogin = info.authorLogin;
  }
  const outcome = await createIngestRoutines(handle, ctx).triggerGeneration({
    pullRequest,
    headSha: info.headSha,
    debounceSeconds: FOLLOW_UP_DEBOUNCE_SECONDS,
    grantId: input.grantId,
  });
  if (!outcome.ok) {
    // The only expected failure is an invalid debounce — ours is constant.
    throw new Error(outcome.error.message);
  }
  input.log.info(
    `generate: url-box head advanced — queued ${info.headSha.slice(0, 8)}`,
  );
}
