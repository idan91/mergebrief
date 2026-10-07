// Post-now's session side: the draft read before anything is written, the
// claim this attempt holds, and the GitHub check an in-doubt draft gets
// before it is posted again.
import type { Context } from "hono";
import {
  ClaimStates,
  deriveClaimState,
  type DraftClaim,
  type SettleClaimInput,
} from "persistence";
import type { InlineReviewCommentResult } from "github";
import { ApiErrorCodes } from "contract";
import type { Mutable } from "types/utils";
import { BadGateway, Conflict } from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../../auth/reviewer-github-client";
import type { AuthzEnv } from "../../../../authz";
import {
  resolveRepoOwnerAndName,
  throwRepoResolveFailure,
} from "../../../logic/resolve-repo-owner-and-name";
import type { ResolvedSessionWrite } from "../../session/controller";
import { throwSessionWriteFailure } from "../../session/logic/write-seam";
import type { HeldDraft } from "../../session/types";
import {
  deriveWriteDeadline,
  findPostedComment,
  hasReviewFoldedDraft,
  hasWriteDeadlinePassed,
  isCommentUnsent,
  listViewerReviews,
  publishComment,
  releaseUnsentClaim,
} from "../../publish";
import type {
  ClaimLedger,
  PublishDeps,
  PublishTarget,
} from "../../publish/types";
import type { PublishPin } from "../types";
import { throwPublishFailure } from "./wire-failures";

/** The draft `draftId` names, read without creating the session. */
export async function readHeldDraft(
  resolved: ResolvedSessionWrite,
  draftId: bigint,
): Promise<HeldDraft | undefined> {
  const held = await resolved.publish.readDrafts();
  if (!held.ok) {
    throwSessionWriteFailure(held.error);
  }
  return held.value.find(
    (row) => row.id === draftId || row.carriedFromCommentId === draftId,
  );
}

export function isClaimInDoubt(draft: HeldDraft): boolean {
  return deriveClaimState(draft, new Date()) === ClaimStates.IN_DOUBT;
}

/**
 * Hold the draft for this attempt. Unknown, published, orphaned, frozen and
 * already-claimed drafts are refused here, with nothing written.
 */
export async function claimDraft(
  resolved: ResolvedSessionWrite,
  draftId: bigint,
): Promise<DraftClaim> {
  const claimed = await resolved.publish.claim([draftId]);
  if (!claimed.ok) {
    throwSessionWriteFailure(claimed.error);
  }
  return claimed.value;
}

/** Where the comment goes: the repo's name re-read fresh, pinned to the read head. */
export async function resolvePublishTarget(
  c: Context<AuthzEnv>,
  github: ReviewerGitHubClient,
  pin: PublishPin,
): Promise<PublishTarget> {
  const resolved = await resolveRepoOwnerAndName({ github }, pin.repoId);
  if (!resolved.ok) {
    throwRepoResolveFailure(resolved.error, c.get("urlBoxOnly") === true);
  }
  return {
    owner: resolved.value.owner,
    repo: resolved.value.repo,
    prNumber: pin.prNumber,
    commitId: pin.commitId,
  };
}

/**
 * Post the claimed draft. A failure that certainly never reached GitHub
 * releases the claim; one that may have posted keeps it, and the draft is
 * checked against GitHub once the claim is in doubt. Past the claim's write
 * deadline nothing is sent.
 */
export async function postClaimedDraft(
  deps: PublishDeps,
  ledger: ClaimLedger,
  target: PublishTarget,
  claim: DraftClaim,
): Promise<InlineReviewCommentResult> {
  const [draft] = claim.drafts;
  if (draft === undefined) {
    throw new Error("a claim on one draft held no row");
  }
  const expired = hasWriteDeadlinePassed(deriveWriteDeadline(claim.drafts));
  if (expired) {
    await releaseUnsentClaim(ledger, deps.log, claim.claim);
    throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
  }

  const posted = await publishComment(deps, target, draft);
  if (!posted.ok) {
    if (isCommentUnsent(posted.error)) {
      await releaseUnsentClaim(ledger, deps.log, claim.claim);
    }
    throwPublishFailure(posted.error);
  }
  return posted.value;
}

/**
 * The GitHub write is the commit point; settling the claim is how the
 * session records it, and the wrapping review id is how a later read knows
 * the comment as the reviewer's own. A failure here leaves a held draft that
 * is on GitHub, logged, never an error response, which would invite a
 * second post.
 */
export async function recordPublishedDraft(
  c: Context<AuthzEnv>,
  resolved: ResolvedSessionWrite,
  claim: string,
  posted: InlineReviewCommentResult,
): Promise<void> {
  const { commentId, reviewId } = posted;
  const settled: Mutable<SettleClaimInput> = { claim };
  if (reviewId !== undefined) {
    settled.githubReviewId = reviewId;
  }
  try {
    const flipped = await resolved.publish.settle(settled);
    if (!flipped.ok) {
      if (flipped.error.kind === FailureKinds.SESSION_REJECTED) {
        throw new Error(flipped.error.error.code);
      }
      throw new Error(flipped.error.kind);
    }
    if (flipped.value === 0) {
      c.get("logger").error("publish claim was gone when its comment landed", {
        commentId: String(commentId),
      });
    }
  } catch (flipError) {
    // NOT `audit.fail`: that name is the audit ROW failing to persist,
    // and this is the session's own publication flip.
    c.get("logger").error("draft stayed unpublished after a posted comment", {
      commentId: String(commentId),
      err: flipError,
    });
  }
}

/** The other drafts the claim holds: a Submit claims every draft at once. */
async function readClaimSiblings(
  resolved: ResolvedSessionWrite,
  draft: HeldDraft,
  claim: string,
): Promise<readonly HeldDraft[]> {
  const held = await resolved.publish.readDrafts();
  if (!held.ok) {
    throwSessionWriteFailure(held.error);
  }
  return held.value.filter(
    (row) => row.publishClaim === claim && row.id !== draft.id,
  );
}

/**
 * A draft whose earlier attempt never reported back, looked for on GitHub
 * with every draft its claim holds. This draft found published settles the
 * claim and answers it as posted; another one found means that attempt's
 * review landed with this draft in its body. Nothing found, and no review
 * since that holds this draft folded, releases the claim so this request
 * posts it. A draft found only in the viewer's pending review, such a
 * review, or a check that cannot tell, refuses with the claim kept, and the
 * reviewer decides.
 */
export async function checkInDoubtDraft(
  c: Context<AuthzEnv>,
  resolved: ResolvedSessionWrite,
  deps: PublishDeps,
  target: PublishTarget,
  draft: HeldDraft,
): Promise<InlineReviewCommentResult | undefined> {
  const { publishClaim: claim, publishClaimedAt: claimedAt } = draft;
  const unclaimed = claim === null || claimedAt === null;
  if (unclaimed) {
    return undefined;
  }

  const viewerId = c.get("session").reviewerId;
  const reviews = await listViewerReviews(deps, target, viewerId);
  if (!reviews.ok) {
    throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT);
  }
  const siblings = await readClaimSiblings(resolved, draft, claim);
  const found = await findPostedComment(deps, target, {
    viewerId,
    claimedAt,
    viewerReviews: reviews.value,
    drafts: [draft, ...siblings],
  });
  if (!found.ok) {
    throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT);
  }

  const match = found.value;
  if (match === undefined) {
    if (hasReviewFoldedDraft(reviews.value, draft, claimedAt)) {
      throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT);
    }
    await releaseUnsentClaim(resolved.publish, deps.log, claim);
    return undefined;
  }
  await recordPublishedDraft(c, resolved, claim, match.posted);
  if (match.draft.id !== draft.id) {
    throw new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED);
  }
  return match.posted;
}
