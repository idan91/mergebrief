import type { Context } from "hono";
import { createTenantRepository, type DraftClaim } from "persistence";
import { AnchorStatuses, DraftCommentStatuses } from "types/comments";
import { ApiErrorCodes } from "contract";
import {
  BadRequest,
  Conflict,
  NotFound,
} from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../../access/types";
import {
  resolveRepoOwnerAndName,
  throwRepoResolveFailure,
} from "../../logic/resolve-repo-owner-and-name";
import {
  resolveSessionWrite,
  throwSessionWriteFailure,
} from "../session/logic/write-seam";
import {
  commitShaSchema,
  prNumberSchema,
  MAX_BODY_LENGTH,
} from "../../../wire-bounds";
import { throwSubmitFailure } from "./logic/wire-failures";
import { ReviewOutcomes, type ReviewOutcome } from "types/reviews";
import { submitBodySchema } from "./schemas";
import type { EvictConversation } from "./types";
import { resolvePrScopeFrom } from "../scope";
import {
  deriveWriteDeadline,
  foldEveryDraftIntoBody,
  isReviewUnsent,
  publishReview,
  releaseUnsentClaim,
} from "../publish";
import type { ResolvedSessionWrite } from "../session/controller";
import type { HeldDraft } from "../session/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The session's unposted drafts, read without creating the session and
 * refused before any GitHub call is spent: an orphaned anchor is the same
 * 409 the publish path uses; a session-store refusal maps through
 * `throwSessionWriteFailure`.
 */
async function resolveSubmittableDrafts(
  resolved: ResolvedSessionWrite,
): Promise<readonly HeldDraft[]> {
  const held = await resolved.publish.readDrafts();
  if (!held.ok) {
    throwSessionWriteFailure(held.error);
  }
  const drafts = held.value.filter(
    (row) => row.status === DraftCommentStatuses.DRAFT,
  );
  // Posting an orphaned anchor lands the comment on unrelated lines;
  // dropping it reports feedback that never landed. Re-anchoring or
  // deleting the draft clears it.
  if (drafts.some((row) => row.anchorStatus === AnchorStatuses.ORPHANED)) {
    throw new Conflict(ApiErrorCodes.DRAFT_ANCHOR_ORPHANED);
  }
  return drafts;
}

/**
 * Hold the drafts for this submit, saved before GitHub is called. A pending
 * or in-doubt draft refuses the whole submit; the reviewer settles an
 * in-doubt one by posting it on its own or deleting it.
 */
async function claimSubmittableDrafts(
  resolved: ResolvedSessionWrite,
  drafts: readonly HeldDraft[],
): Promise<DraftClaim> {
  const claimed = await resolved.publish.claim(drafts.map((row) => row.id));
  if (!claimed.ok) {
    throwSessionWriteFailure(claimed.error);
  }
  return claimed.value;
}

/**
 * The two deterministic 400s an accepted submit must clear: a neutral
 * review that says nothing, and a fold that would blow GitHub's body cap
 * if GitHub rejects every anchor and every comment moves into the body.
 */
function assertSubmitRepresentable(
  submitBody: { outcome: ReviewOutcome; body?: string | undefined },
  drafts: readonly HeldDraft[],
): void {
  if (
    submitBody.outcome === ReviewOutcomes.COMMENT &&
    drafts.length === 0 &&
    (submitBody.body ?? "").trim() === ""
  ) {
    throw new BadRequest();
  }
  const worstFold = foldEveryDraftIntoBody(submitBody.body, drafts);
  if (worstFold !== undefined && worstFold.length > MAX_BODY_LENGTH) {
    throw new BadRequest();
  }
}

/**
 * The review is live on GitHub; this is the session's own bookkeeping. A
 * failure here is logged, never an error response, that would invite a
 * retry that posts the review twice.
 */
async function recordSubmittedDrafts(
  c: Context<AuthzEnv>,
  resolved: ResolvedSessionWrite,
  claim: DraftClaim,
  reviewId: bigint,
) {
  try {
    const recorded = await resolved.publish.settle({
      claim: claim.claim,
      githubReviewId: reviewId,
    });
    if (!recorded.ok) {
      if (recorded.error.kind === FailureKinds.SESSION_REJECTED) {
        throw new Error(recorded.error.error.code);
      }
      throw new Error(recorded.error.kind);
    }
    const claimLost = recorded.value === 0 && claim.drafts.length > 0;
    if (claimLost) {
      c.get("logger").error("publish claim was gone when its review landed", {
        reviewId: String(reviewId),
      });
    }
  } catch (bookkeepingError) {
    // NOT `audit.fail`: the audit row is the choke point's to write, and
    // raising that event for session bookkeeping alerts on the wrong failure.
    c.get("logger").error("session unrecorded after a submitted review", {
      reviewId: String(reviewId),
      err: bookkeepingError,
    });
  }
}

export function createReviewHandlers(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
) {
  /** Post ONE formal review with the VIEWER's token: pending, threads, submit. */
  const submitReview = async (c: Context<AuthzEnv>) => {
    const parsedBody = submitBodySchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedBody.success || !parsedPr.success) {
      throw new BadRequest();
    }
    const submitBody = parsedBody.data;

    const ctx = await resolvePrScopeFrom(c, deps.handle, parsedPr.data);
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(c.get("repoId"), parsedPr.data);
    if (pr === undefined) {
      throw new NotFound();
    }

    // The session answers before a GitHub call is spent: the drafts are read
    // without writing, so a refused submit leaves no session, and the claim
    // refuses a frozen tab or a draft another attempt holds.
    const resolved = await resolveSessionWrite(deps, c);
    const commitId = commitShaSchema.safeParse(resolved.head);
    if (!commitId.success) {
      throw new BadRequest();
    }
    const drafts = await resolveSubmittableDrafts(resolved);
    assertSubmitRepresentable(submitBody, drafts);
    const claim = await claimSubmittableDrafts(resolved, drafts);

    // One refresh-once budget for the WHOLE request, shared across the fresh
    // slug resolve, the pending review, every thread and the submit.
    const log = c.get("logger");
    const github = createReviewerGitHubClient(deps, c.get("session"), log);
    const target = await resolveRepoOwnerAndName({ github }, c.get("repoId"));
    if (!target.ok) {
      await releaseUnsentClaim(resolved.publish, log, claim.claim);
      throwRepoResolveFailure(target.error, c.get("urlBoxOnly") === true);
    }

    const created = await publishReview(
      { github, log },
      {
        target: {
          owner: target.value.owner,
          repo: target.value.repo,
          prNumber: pr.prNumber,
          commitId: commitId.data,
        },
        outcome: submitBody.outcome,
        body: submitBody.body,
        drafts: claim.drafts,
        writeDeadline: deriveWriteDeadline(claim.drafts),
      },
    );
    if (!created.ok) {
      if (isReviewUnsent(created.error)) {
        await releaseUnsentClaim(resolved.publish, log, claim.claim);
      }
      throwSubmitFailure(created.error);
    }

    // The review is on GitHub: the drafts it carried are published, and the
    // review id is what the session's own comments join on. A failure here
    // leaves drafts that are already posted, logged, never an error
    // response, which would invite a second review.
    // Nothing past this line may reach the error path: the review is live,
    // and an error response would invite a retry that posts it twice.
    stampAuditTarget(c, "pull_request", pr.id);
    await recordSubmittedDrafts(c, resolved, claim, created.value.reviewId);

    // A submitted review is a conversation write, the cached conversation
    // is stale the moment it lands.
    evictConversation(ctx, c.get("repoId"), pr.prNumber);

    // `commentsDegraded` stays one release for the CLI receipt; the counts
    // are what the web copy reads.
    return c.json(
      {
        reviewId: Number(created.value.reviewId),
        commentsDegraded: created.value.commentsFolded > 0,
        commentsFolded: created.value.commentsFolded,
        commentsTotal: created.value.commentsTotal,
      },
      HttpStatuses.CREATED,
      NO_STORE,
    );
  };

  return { submitReview };
}
