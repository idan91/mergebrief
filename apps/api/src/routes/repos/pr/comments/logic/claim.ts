// Post-now's session side: the draft read before anything is written, the
// claim this attempt holds, and the GitHub check an in-doubt draft gets
// before it is posted again.
import type { InlineReviewCommentResult, ReviewerRepoClient } from "github";
import type { Logger } from "logging";
import {
  ClaimStates,
  deriveClaimState,
  type DraftClaim,
  type SettleClaimInput,
} from "persistence";
import type { Mutable, Result } from "types/utils";
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
import type { ClaimLedger, CommentPin } from "../../publish/types";
import type { ResolvedSessionWrite } from "../../session/logic/session-writes";
import type { HeldDraft, SessionWriteFailure } from "../../session/types";
import type { InDoubtCheck, PostNowFailure, PostNowResult } from "../types";

const IN_DOUBT = { ok: false, error: { kind: "publish-in-doubt" } } as const;

/** The draft `draftId` names, read without creating the session. */
export async function readHeldDraft(
  session: ResolvedSessionWrite,
  draftId: bigint,
): Promise<Result<HeldDraft | undefined, SessionWriteFailure>> {
  const held = await session.publish.readDrafts();
  if (!held.ok) {
    return held;
  }
  const draft = held.value.find(
    (row) => row.id === draftId || row.carriedFromCommentId === draftId,
  );
  return { ok: true, value: draft };
}

export function isClaimInDoubt(draft: HeldDraft): boolean {
  return deriveClaimState(draft, new Date()) === ClaimStates.IN_DOUBT;
}

/**
 * Hold the draft for this attempt. Unknown, published, orphaned, frozen and
 * already-claimed drafts are refused here, with nothing written.
 */
export async function claimDraft(
  session: ResolvedSessionWrite,
  draftId: bigint,
): Promise<Result<DraftClaim, SessionWriteFailure>> {
  return session.publish.claim([draftId]);
}

/**
 * Post the claimed draft. A failure that certainly never reached GitHub
 * releases the claim; one that may have posted keeps it, and the draft is
 * checked against GitHub once the claim is in doubt. Past the claim's write
 * deadline nothing is sent.
 */
export async function postClaimedDraft(
  log: Logger,
  ledger: ClaimLedger,
  repo: ReviewerRepoClient,
  pin: CommentPin,
  claim: DraftClaim,
): Promise<PostNowResult> {
  const [draft] = claim.drafts;
  if (draft === undefined) {
    throw new Error("a claim on one draft held no row");
  }
  const expired = hasWriteDeadlinePassed(deriveWriteDeadline(claim.drafts));
  if (expired) {
    await releaseUnsentClaim(ledger, log, claim.claim);
    return { ok: false, error: { kind: "publish-expired" } };
  }

  const posted = await publishComment(repo, pin, draft);
  if (!posted.ok && isCommentUnsent(posted.error)) {
    await releaseUnsentClaim(ledger, log, claim.claim);
  }
  return posted;
}

/**
 * The GitHub write is the commit point; settling the claim is how the
 * session records it, and the wrapping review id is how a later read knows
 * the comment as the reviewer's own. A failure here leaves a held draft that
 * is on GitHub, logged, never an error response, which would invite a
 * second post.
 */
export async function recordPublishedDraft(
  log: Logger,
  session: ResolvedSessionWrite,
  claim: string,
  posted: InlineReviewCommentResult,
): Promise<void> {
  const { commentId, reviewId } = posted;
  const settled: Mutable<SettleClaimInput> = { claim };
  if (reviewId !== undefined) {
    settled.githubReviewId = reviewId;
  }
  try {
    const flipped = await session.publish.settle(settled);
    if (!flipped.ok) {
      throw new Error(flipped.error.error.code);
    }
    if (flipped.value === 0) {
      log.error("publish claim was gone when its comment landed", {
        commentId: String(commentId),
      });
    }
  } catch (flipError) {
    // NOT `audit.fail`: that name is the audit ROW failing to persist,
    // and this is the session's own publication flip.
    log.error("draft stayed unpublished after a posted comment", {
      commentId: String(commentId),
      err: flipError,
    });
  }
}

/** The other drafts the claim holds: a Submit claims every draft at once. */
async function readClaimSiblings(
  session: ResolvedSessionWrite,
  draft: HeldDraft,
  claim: string,
): Promise<Result<readonly HeldDraft[], SessionWriteFailure>> {
  const held = await session.publish.readDrafts();
  if (!held.ok) {
    return held;
  }
  const siblings = held.value.filter(
    (row) => row.publishClaim === claim && row.id !== draft.id,
  );
  return { ok: true, value: siblings };
}

/**
 * A draft whose earlier attempt never reported back, looked for on GitHub
 * with every draft its claim holds, on the viewer's own reads only. This
 * draft found published settles the claim and answers it as posted; another
 * one found means that attempt's review landed with this draft in its body.
 * Nothing found, and no review since that holds this draft folded, releases
 * the claim so this request posts it. Anything else keeps the claim.
 */
export async function checkInDoubtDraft(
  check: InDoubtCheck,
  draft: HeldDraft,
): Promise<Result<InlineReviewCommentResult | undefined, PostNowFailure>> {
  const { publishClaim: claim, publishClaimedAt: claimedAt } = draft;
  const unclaimed = claim === null || claimedAt === null;
  if (unclaimed) {
    return { ok: true, value: undefined };
  }

  const { repo, prNumber, viewerId } = check;
  const reviews = await listViewerReviews(repo, prNumber, viewerId);
  if (!reviews.ok) {
    return IN_DOUBT;
  }
  const siblings = await readClaimSiblings(check.session, draft, claim);
  if (!siblings.ok) {
    return siblings;
  }
  const found = await findPostedComment(repo, prNumber, {
    viewerId,
    claimedAt,
    viewerReviews: reviews.value,
    drafts: [draft, ...siblings.value],
  });
  if (!found.ok) {
    return IN_DOUBT;
  }

  const match = found.value;
  if (match === undefined) {
    if (hasReviewFoldedDraft(reviews.value, draft, claimedAt)) {
      return IN_DOUBT;
    }
    await releaseUnsentClaim(check.session.publish, check.log, claim);
    return { ok: true, value: undefined };
  }
  await recordPublishedDraft(check.log, check.session, claim, match.posted);
  if (match.draft.id !== draft.id) {
    return { ok: false, error: { kind: "sibling-published" } };
  }
  return { ok: true, value: match.posted };
}
