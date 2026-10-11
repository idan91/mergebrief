// Hono-free. Held drafts reach GitHub one of two ways: post-now sends one
// REST comment, Submit opens a PENDING review, attaches one GraphQL thread
// per comment and submits it with the verdict. Both shape the anchor through
// `readGitHubAnchor`, and every create rides the bound repo client's
// retry-off runner, because a replayed POST or mutation is a duplicate.
import {
  CredentialFailureCodes,
  type AuthoredReview,
  type GitHubCallFailure,
  type PendingReview,
  type ReviewerRepoClient,
} from "github";
import type { Logger } from "logging";
import { PUBLISH_CLAIM_LEASE_MS, type ClaimStamp } from "persistence";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import { FailureKinds } from "../../../../shared-errors/failures";
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
  CommentPin,
  CommentPublishFailure,
  CommentPublishResult,
  PostedCommentLookupResult,
  PostedCommentQuery,
  PostThreadsFailure,
  PublishableDraft,
  PublishDeps,
  PublishedReview,
  ReviewPublishFailure,
  ReviewPublishInput,
  ReviewPublishResult,
  ViewerReviewListResult,
} from "./types";

/** A GitHub refusal of a publish call, riding the failure whole. */
function shapeMutationDenied(
  error: GitHubCallFailure,
): Result<never, CommentPublishFailure> {
  return {
    ok: false,
    error: { kind: FailureKinds.GITHUB_DENIED, phase: "mutation", error },
  };
}

/**
 * Post one held draft as an inline review comment on the bound repo's
 * retry-off client. A 401'd POST created nothing, so the binding's renewed
 * re-run cannot double-post.
 */
export async function publishComment(
  repo: ReviewerRepoClient,
  pin: CommentPin,
  draft: PublishableDraft,
): Promise<CommentPublishResult> {
  const input = shapeInlineCommentInput(shapePublishComment(draft), pin);
  const posted = await repo.createInlineReviewComment(input);
  if (!posted.ok) {
    return shapeMutationDenied(posted.error);
  }
  return posted;
}

/**
 * The submit mutation failed: the review published anyway (its listing says
 * so), or it did not and its pending review goes, or the listing could not
 * be read and nobody knows. A credential that never decrypted sent nothing.
 */
async function checkFailedSubmit(
  deps: PublishDeps,
  prNumber: number,
  pending: PendingReview,
  error: GitHubCallFailure,
): Promise<Result<void, ReviewPublishFailure>> {
  if (error.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE) {
    await discardPendingReview(deps, prNumber, pending);
    return shapeMutationDenied(error);
  }
  const landed = await readSubmitLanded(deps.repo, prNumber, pending);
  if (landed.ok && landed.value) {
    return { ok: true, value: undefined };
  }

  await discardPendingReview(deps, prNumber, pending);
  if (!landed.ok) {
    return { ok: false, error: { kind: "submit-unconfirmed" } };
  }
  return shapeMutationDenied(error);
}

function shapeThreadsFailure(
  error: PostThreadsFailure,
): Result<never, ReviewPublishFailure> {
  if ("kind" in error) {
    return { ok: false, error };
  }
  return shapeMutationDenied(error);
}

/**
 * Post the held drafts as one review on the viewer's retry-off creates. A
 * thread GitHub rejects is folded into the body; any failure after the
 * pending review exists deletes it before returning, so the client's retry
 * starts clean.
 */
export async function publishReview(
  deps: PublishDeps,
  input: ReviewPublishInput,
): Promise<ReviewPublishResult> {
  const { prNumber } = input.pin;
  const comments = input.drafts.map(shapePublishComment);

  const pending = await openPendingReview(deps.repo, input.pin);
  if (!pending.ok) {
    if (isPendingReviewHeld(pending.error)) {
      return { ok: false, error: pending.error };
    }
    return shapeMutationDenied(pending.error);
  }

  const threads = await postReviewThreads(
    createThreadPoster(deps.repo),
    pending.value.reviewNodeId,
    comments,
    () => hasWriteDeadlinePassed(input.writeDeadline),
  );
  if (!threads.ok) {
    await discardPendingReview(deps, prNumber, pending.value);
    return shapeThreadsFailure(threads.error);
  }

  const body = foldCommentsIntoBody(
    input.body,
    threads.value.rejected,
    comments.length,
  );
  if (hasWriteDeadlinePassed(input.writeDeadline)) {
    await discardPendingReview(deps, prNumber, pending.value);
    return { ok: false, error: { kind: "publish-expired" } };
  }
  const event = OutcomeToEvent[input.outcome];
  const submitted = await submitPendingReview(
    deps.repo,
    pending.value,
    event,
    body,
  );
  if (!submitted.ok) {
    const checked = await checkFailedSubmit(
      deps,
      prNumber,
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
  repo: ReviewerRepoClient,
  prNumber: number,
  query: PostedCommentQuery<Draft>,
): Promise<PostedCommentLookupResult<Draft>> {
  const since = deriveLookupSince(query.claimedAt);
  const listed = await repo.listReviewCommentsSince({ prNumber, since });
  if (!listed.ok) {
    return shapeMutationDenied(listed.error);
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
  repo: ReviewerRepoClient,
  prNumber: number,
  viewerId: bigint,
): Promise<ViewerReviewListResult> {
  return repo.listReviewsByAuthor({ prNumber, authorId: viewerId });
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
  const { error } = failure;
  if (error.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE) {
    return true;
  }
  const { status } = error;
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
