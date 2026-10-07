import type { Context } from "hono";
import { createTenantRepository } from "persistence";
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
import type { AuthzEnv } from "../../../authz";
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
import { reviewController } from "./controller";
import { throwSubmitFailure } from "./logic/wire-failures";
import { OutcomeToEvent } from "./consts";
import { ReviewOutcomes, type ReviewOutcome } from "./types";
import {
  foldCommentsIntoBody,
  shapeSubmitComment,
  type SubmitComment,
} from "./logic/submit-comments";
import { submitBodySchema } from "./schemas";
import type { EvictConversation } from "./types";
import { resolvePrScopeFrom } from "../scope";
import { FailureKinds } from "../../../../shared-errors/failures";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The session's unposted drafts, refused before any GitHub call is spent:
 * an orphaned anchor is the same 409 the publish path uses; a session-store
 * refusal maps through `throwSessionWriteFailure`.
 */
async function resolveSubmittableDrafts(
  c: Context<AuthzEnv>,
  resolved: Awaited<ReturnType<typeof resolveSessionWrite>>,
) {
  const held = await resolved.publish.listDrafts();
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
 * The two deterministic 400s an accepted submit must clear: a neutral
 * review that says nothing, and a fold that would blow GitHub's body cap
 * if GitHub rejects every anchor and every comment moves into the body.
 */
function assertSubmitRepresentable(
  submitBody: { outcome: ReviewOutcome; body?: string | undefined },
  comments: readonly SubmitComment[],
): void {
  if (
    submitBody.outcome === ReviewOutcomes.COMMENT &&
    comments.length === 0 &&
    (submitBody.body ?? "").trim() === ""
  ) {
    throw new BadRequest();
  }
  const worstFold = foldCommentsIntoBody(
    submitBody.body,
    comments,
    comments.length,
  );
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
  resolved: Awaited<ReturnType<typeof resolveSessionWrite>>,
  drafts: readonly { id: bigint }[],
  reviewId: bigint,
) {
  try {
    const recorded = await resolved.publish.recordPublishedDrafts({
      draftIds: drafts.map((row) => row.id),
      githubReviewId: reviewId,
    });
    if (!recorded.ok) {
      if (recorded.error.kind === FailureKinds.SESSION_REJECTED) {
        throw new Error(recorded.error.error.code);
      }
      throw new Error(recorded.error.kind);
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

    // The session answers before a GitHub call is spent: a frozen tab is
    // refused here, and the drafts to publish are read off its rows.
    const resolved = await resolveSessionWrite(deps, c);
    const commitId = commitShaSchema.safeParse(resolved.head);
    if (!commitId.success) {
      throw new BadRequest();
    }
    const drafts = await resolveSubmittableDrafts(c, resolved);
    const comments = drafts.map(shapeSubmitComment);
    assertSubmitRepresentable(submitBody, comments);

    // One refresh-once budget for the WHOLE request, shared across the fresh
    // slug resolve, the pending review, every thread and the submit.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const target = await resolveRepoOwnerAndName({ github }, c.get("repoId"));
    if (!target.ok) {
      throwRepoResolveFailure(target.error, c.get("urlBoxOnly") === true);
    }

    const created = await reviewController.submitReview(
      { github, log: c.get("logger") },
      {
        target: {
          owner: target.value.owner,
          repo: target.value.repo,
          prNumber: pr.prNumber,
          commitId: commitId.data,
        },
        event: OutcomeToEvent[submitBody.outcome],
        body: submitBody.body,
        comments,
      },
    );
    if (!created.ok) {
      throwSubmitFailure(created.error);
    }

    // The review is on GitHub: the drafts it carried are published, and the
    // review id is what the session's own comments join on. A failure here
    // leaves drafts that are already posted, logged, never an error
    // response, which would invite a second review.
    // Nothing past this line may reach the error path: the review is live,
    // and an error response would invite a retry that posts it twice.
    stampAuditTarget(c, "pull_request", pr.id);
    await recordSubmittedDrafts(c, resolved, drafts, created.value.reviewId);

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
