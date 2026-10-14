// Submit's session side: the drafts read before anything is written, the
// deterministic refusals they face, and the record a landed review leaves.
import { RequestBounds } from "contract";
import type { Logger } from "logging";
import type { DraftClaim } from "persistence";
import {
  AnchorStatuses,
  DraftCommentStatuses,
  type Result,
  ReviewOutcomes,
} from "types";
import { foldEveryDraftIntoBody } from "../../publish";
import type { ResolvedSessionWrite } from "../../session/logic/session-writes";
import type { HeldDraft } from "../../session/types";
import type { SubmitReviewFailure, SubmitReviewRequest } from "../types";

/**
 * The session's unposted drafts, read without creating the session. Posting
 * an orphaned anchor lands the comment on unrelated lines and dropping it
 * reports feedback that never landed, so one refuses the submit until the
 * reviewer re-anchors or deletes it.
 */
export async function readSubmittableDrafts(
  session: ResolvedSessionWrite,
): Promise<Result<readonly HeldDraft[], SubmitReviewFailure>> {
  const held = await session.publish.readDrafts();
  if (!held.ok) {
    return held;
  }
  const drafts = held.value.filter(
    (row) => row.status === DraftCommentStatuses.DRAFT,
  );
  if (drafts.some((row) => row.anchorStatus === AnchorStatuses.ORPHANED)) {
    return { ok: false, error: { kind: "draft-anchor-orphaned" } };
  }
  return { ok: true, value: drafts };
}

/**
 * Whether the submit clears the two deterministic 400s: a neutral review
 * that says nothing, and a body past GitHub's cap once every anchor is
 * rejected and every comment folds into it.
 */
export function isSubmitAcceptable(
  request: Pick<SubmitReviewRequest, "outcome" | "body">,
  drafts: readonly HeldDraft[],
): boolean {
  const saysNothing =
    request.outcome === ReviewOutcomes.COMMENT &&
    drafts.length === 0 &&
    (request.body ?? "").trim() === "";
  if (saysNothing) {
    return false;
  }
  const worstFold = foldEveryDraftIntoBody(request.body, drafts);
  const fitsBodyBound =
    worstFold === undefined || worstFold.length <= RequestBounds.BODY_LENGTH;
  return fitsBodyBound;
}

/**
 * The review is live on GitHub; settling the claim is the session's own
 * bookkeeping, and the review id is what its comments join on. A failure
 * here is logged, never an error response, which would invite a retry that
 * posts the review twice.
 */
export async function recordSubmittedReview(
  log: Logger,
  session: ResolvedSessionWrite,
  claim: DraftClaim,
  reviewId: bigint,
): Promise<void> {
  try {
    const recorded = await session.publish.settle({
      claim: claim.claim,
      githubReviewId: reviewId,
    });
    if (!recorded.ok) {
      throw new Error(recorded.error.error.code);
    }
    const claimLost = recorded.value === 0 && claim.drafts.length > 0;
    if (claimLost) {
      log.error("publish claim was gone when its review landed", {
        reviewId: String(reviewId),
      });
    }
  } catch (bookkeepingError) {
    // NOT `audit.fail`: the audit row is the choke point's to write, and
    // raising that event for session bookkeeping alerts on the wrong failure.
    log.error("session unrecorded after a submitted review", {
      reviewId: String(reviewId),
      err: bookkeepingError,
    });
  }
}
