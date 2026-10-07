// Hono-free. Held drafts reach GitHub one of two ways: post-now sends one
// REST comment, Submit opens a PENDING review, attaches one GraphQL thread
// per comment and submits it with the verdict. Both shape the anchor through
// `readGitHubAnchor`, and every write rides a client with octokit's retry
// off, because a replayed POST or mutation is a duplicate comment.
import {
  createInlineReviewComment,
  listReviewCommentsSince,
  listReviewsByAuthor,
  type AuthoredReview,
  type GitHubApiError,
  type PendingReview,
} from "github";
import type { Logger } from "logging";
import { PUBLISH_CLAIM_LEASE_MS, type ClaimStamp } from "persistence";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import {
  buildGitHubDeniedResult,
  FailureKinds,
  isTokenUnreadableFailure,
  type TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import { OutcomeToEvent, WRITE_DEADLINE_MARGIN_MS } from "./consts";
import { shapeInlineCommentInput, shapePublishComment } from "./logic/anchor";
import { foldCommentsIntoBody } from "./logic/fold";
import {
  deriveLookupSince,
  hasReviewFoldedComment,
  matchPostedComment,
  partitionPendingReviewComments,
} from "./logic/in-doubt";
import {
  createThreadPoster,
  discardPendingReview,
  isPendingReviewHeld,
  openPendingReview,
  readSubmitLanded,
  submitPendingReview,
} from "./logic/pending-review";
import { postReviewThreads } from "./logic/threads";
import type {
  ClaimLedger,
  CommentPublishFailure,
  CommentPublishResult,
  PostedCommentLookupResult,
  PostedCommentQuery,
  PostThreadsFailure,
  PublishableDraft,
  PublishDeps,
  PublishedReview,
  PublishTarget,
  ReviewPublishFailure,
  ReviewPublishInput,
  ReviewPublishResult,
  ViewerReviewListResult,
} from "./types";

/**
 * Post one held draft as an inline review comment. A 401'd POST created
 * nothing, so the client's refreshed re-run cannot double-post.
 */
export async function publishComment(
  deps: PublishDeps,
  target: PublishTarget,
  draft: PublishableDraft,
): Promise<CommentPublishResult> {
  const input = shapeInlineCommentInput(shapePublishComment(draft), target);
  const posted = await deps.github.run((token) =>
    createInlineReviewComment(deps.github.createMutationOctokit(token), input),
  );
  if (!posted.ok) {
    return buildGitHubDeniedResult(posted.error, "mutation");
  }
  return posted;
}

/**
 * The submit mutation failed: the review published anyway (its listing says
 * so), or it did not and its pending review goes, or the listing could not
 * be read and nobody knows.
 */
async function checkFailedSubmit(
  deps: PublishDeps,
  target: PublishTarget,
  pending: PendingReview,
  error: GitHubApiError | TokenUnreadableFailure,
): Promise<Result<void, ReviewPublishFailure>> {
  if (isTokenUnreadableFailure(error)) {
    await discardPendingReview(deps, target, pending);
    return { ok: false, error };
  }
  const landed = await readSubmitLanded(deps, target, pending);
  if (landed.ok && landed.value) {
    return { ok: true, value: undefined };
  }

  await discardPendingReview(deps, target, pending);
  if (!landed.ok) {
    return { ok: false, error: { kind: "submit-unconfirmed" } };
  }
  return buildGitHubDeniedResult(error, "mutation");
}

function shapeThreadsFailure(
  error: PostThreadsFailure,
): Result<never, ReviewPublishFailure> {
  if ("kind" in error && error.kind === "publish-expired") {
    return { ok: false, error };
  }
  return buildGitHubDeniedResult(error, "mutation");
}

/**
 * Post the held drafts as one review. A thread GitHub rejects is folded into
 * the body; a transport failure after the pending review exists deletes it
 * before returning, so the client's retry starts clean.
 */
export async function publishReview(
  deps: PublishDeps,
  input: ReviewPublishInput,
): Promise<ReviewPublishResult> {
  const { target } = input;
  const comments = input.drafts.map(shapePublishComment);

  const pending = await openPendingReview(deps, target);
  if (!pending.ok) {
    if (isPendingReviewHeld(pending.error)) {
      return { ok: false, error: pending.error };
    }
    return buildGitHubDeniedResult(pending.error, "mutation");
  }

  const threads = await postReviewThreads(
    createThreadPoster(deps),
    pending.value.reviewNodeId,
    comments,
    () => hasWriteDeadlinePassed(input.writeDeadline),
  );
  if (!threads.ok) {
    await discardPendingReview(deps, target, pending.value);
    return shapeThreadsFailure(threads.error);
  }

  const body = foldCommentsIntoBody(
    input.body,
    threads.value.rejected,
    comments.length,
  );
  if (hasWriteDeadlinePassed(input.writeDeadline)) {
    await discardPendingReview(deps, target, pending.value);
    return { ok: false, error: { kind: "publish-expired" } };
  }
  const event = OutcomeToEvent[input.outcome];
  const submitted = await submitPendingReview(deps, pending.value, event, body);
  if (!submitted.ok) {
    const checked = await checkFailedSubmit(
      deps,
      target,
      pending.value,
      submitted.error,
    );
    if (!checked.ok) {
      return checked;
    }
  }

  const value: PublishedReview = {
    reviewId: pending.value.reviewId,
    commentsFolded: threads.value.rejected.length,
    commentsTotal: comments.length,
  };
  return { ok: true, value };
}

/**
 * The review body as it would read if GitHub rejected every anchor: the
 * longest body a submit of these drafts can send.
 */
export function foldEveryDraftIntoBody(
  body: string | undefined,
  drafts: readonly PublishableDraft[],
): string | undefined {
  const comments = drafts.map(shapePublishComment);
  return foldCommentsIntoBody(body, comments, comments.length);
}

/**
 * The comment an earlier attempt posted for one of these drafts, looked up
 * among the PR's review comments since a little before that attempt's
 * claim. `undefined` means GitHub holds none. A draft found only in the
 * viewer's pending review, or a list cut short without a match, is a
 * failure, not an absence.
 */
export async function findPostedComment<Draft extends PublishableDraft>(
  deps: PublishDeps,
  target: PublishTarget,
  query: PostedCommentQuery<Draft>,
): Promise<PostedCommentLookupResult<Draft>> {
  const listed = await deps.github.run((token) =>
    listReviewCommentsSince(deps.github.createOctokit(token), {
      owner: target.owner,
      repo: target.repo,
      prNumber: target.prNumber,
      since: deriveLookupSince(query.claimedAt),
    }),
  );
  if (!listed.ok) {
    return buildGitHubDeniedResult(listed.error, "mutation");
  }

  const { comments, complete } = listed.value;
  const { published, pending } = partitionPendingReviewComments(
    comments,
    query.viewerReviews,
  );
  const match = matchPostedComment(published, query.drafts, query.viewerId);
  if (match !== undefined) {
    return { ok: true, value: match };
  }

  const held = matchPostedComment(pending, query.drafts, query.viewerId);
  if (held !== undefined) {
    return { ok: false, error: { kind: "draft-in-pending-review" } };
  }
  if (!complete) {
    return { ok: false, error: { kind: "listing-incomplete" } };
  }
  return { ok: true, value: undefined };
}

/** Every review the viewer holds on the PR, pending ones included. */
export async function listViewerReviews(
  deps: PublishDeps,
  target: PublishTarget,
  viewerId: bigint,
): Promise<ViewerReviewListResult> {
  return deps.github.run((token) =>
    listReviewsByAuthor(deps.github.createOctokit(token), {
      owner: target.owner,
      repo: target.repo,
      prNumber: target.prNumber,
      authorId: viewerId,
    }),
  );
}

/**
 * Whether a review the viewer submitted since a little before the claim
 * holds the draft folded, anchor line and words: a Submit that folded the
 * draft leaves no comment to find, only that review's body.
 */
export function hasReviewFoldedDraft(
  viewerReviews: readonly AuthoredReview[],
  draft: PublishableDraft,
  claimedAt: Date,
): boolean {
  const since = deriveLookupSince(claimedAt);
  const comment = shapePublishComment(draft);
  return hasReviewFoldedComment(viewerReviews, comment, since);
}

/**
 * The last moment a claimed attempt may send a GitHub write: a margin inside
 * the lease, so no write leaves once another attempt may judge the claim in
 * doubt. Rows without a stamp count as claimed now.
 */
export function deriveWriteDeadline(rows: readonly ClaimStamp[]): Date {
  let claimedAt = Date.now();
  for (const row of rows) {
    if (row.publishClaimedAt !== null) {
      claimedAt = Math.min(claimedAt, row.publishClaimedAt.getTime());
    }
  }
  return new Date(
    claimedAt + PUBLISH_CLAIM_LEASE_MS - WRITE_DEADLINE_MARGIN_MS,
  );
}

export function hasWriteDeadlinePassed(deadline: Date): boolean {
  return Date.now() >= deadline.getTime();
}

/**
 * Whether the failed comment certainly never reached GitHub: nothing was
 * sent, or GitHub answered with a refusal. A 5xx or a lost answer may have
 * posted it.
 */
export function isCommentUnsent(failure: CommentPublishFailure): boolean {
  if (failure.kind === FailureKinds.TOKEN_UNREADABLE) {
    return true;
  }
  const { status } = failure.error;
  return status !== undefined && status < HttpStatuses.INTERNAL_SERVER_ERROR;
}

/** Every review failure is unsent except a submit nobody could confirm. */
export function isReviewUnsent(failure: ReviewPublishFailure): boolean {
  return failure.kind !== "submit-unconfirmed";
}

/**
 * Hand the drafts back after a publish that never reached GitHub. A failure
 * here leaves them held until the claim is in doubt; logged, never surfaced.
 */
export async function releaseUnsentClaim(
  ledger: ClaimLedger,
  log: Logger,
  claim: string,
): Promise<void> {
  const message = "publish claim stayed held after an unsent publish";
  try {
    const released = await ledger.release({ claim });
    if (!released.ok) {
      log.error(message, { reason: released.error.error.code });
    }
  } catch (releaseError) {
    log.error(message, { err: releaseError });
  }
}
