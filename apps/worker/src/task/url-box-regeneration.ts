// A url-box PR may have no App installation, so GitHub delivers no webhook
// for it: when a drain finds the head has moved, nothing else will ever
// schedule the head it found. This module re-enqueues that head on the same
// grant before the stale run stands down.
import type { PullRequestInfo } from "github";
import {
  createIngestRoutines,
  type AppDatabase,
  type GrantRowId,
  type PullRequestLifecycle,
  type PullRequestUpsertInput,
  type RepoId,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import type { Logger } from "logging";
import type { Mutable } from "types/utils";

// Matches the paste door's window: coalesces a push burst into one follow-up
// instead of chasing every intermediate head.
const FOLLOW_UP_DEBOUNCE_SECONDS = 10;

export interface UrlBoxRegenerationInput {
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
    };
  }
  if (info.state === "closed") {
    return {
      state: PrStates.CLOSED,
      closedAt: info.closedAt ?? new Date(),
    };
  }
  return { state: PrStates.OPEN };
}

export async function scheduleUrlBoxRegeneration(
  handle: AppDatabase,
  ctx: ScopeContext,
  input: UrlBoxRegenerationInput,
): Promise<void> {
  const { info } = input;
  const pullRequest: Mutable<PullRequestUpsertInput> = {
    repoId: input.repoId,
    prNumber: input.prNumber,
    repoSlug: info.repoFullName,
    title: info.title,
    baseSha: info.baseSha,
    draft: info.draft,
    liveRead: { readAt: new Date(), headSha: info.headSha },
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
  const head = info.headSha.slice(0, 8);
  if (outcome.coveredBy !== undefined) {
    input.log.info(`generate: url-box head advanced to ${head}, brief stored`);
    return;
  }
  input.log.info(`generate: url-box head advanced, queued ${head}`);
}
