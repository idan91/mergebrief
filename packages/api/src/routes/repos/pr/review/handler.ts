import type { Context } from "hono";
import {
  AnchorStatus,
  DraftCommentStatus,
  createTenantRepository,
} from "persistence";
import { ApiErrorCode } from "../../../../error-response";
import {
  BadRequest,
  Conflict,
  NotFound,
} from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import {
  resolveRepoOwnerAndName,
  throwRepoResolveFailure,
} from "../logic/resolve-repo-owner-and-name";
import {
  resolveSessionWrite,
  throwSessionWriteFailure,
} from "../session/logic/write-seam";
import {
  commitShaSchema,
  prNumberSchema,
  MAX_BODY_LENGTH,
} from "../wire-bounds";
import reviewController from "./controller";
import { throwSubmitFailure } from "./logic/wire-failures";
import { OUTCOME_TO_EVENT } from "./consts";
import { ReviewOutcomes, type ReviewOutcome } from "./types";
import {
  foldCommentsIntoBody,
  shapeSubmitComment,
  type SubmitComment,
} from "./logic/submit-comments";
import { submitBodySchema } from "./schemas";
import type { EvictConversation } from "./types";

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
  const held = await resolved.run(async (writer) =>
    (await writer.draftComments()).filter(
      (row) => row.status === DraftCommentStatus.DRAFT,
    ),
  );
  if (!held.ok) {
    throwSessionWriteFailure(held.error);
  }
  const drafts = held.value;
  // Posting an orphaned anchor lands the comment on unrelated lines;
  // dropping it reports feedback that never landed. Re-anchoring or
  // deleting the draft clears it.
  if (drafts.some((row) => row.anchorStatus === AnchorStatus.ORPHANED)) {
    throw new Conflict(ApiErrorCode.DRAFT_ANCHOR_ORPHANED);
  }
  return drafts;
}

/**
 * The two deterministic 400s an accepted submit must clear: a neutral
 * review that says nothing, and a fold that would blow GitHub's body cap
 * if the anchors 422 and every comment moves into the one review body.
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
    throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
  }
  if (
    comments.length > 0 &&
    foldCommentsIntoBody(submitBody.body, comments).length > MAX_BODY_LENGTH
  ) {
    throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
  }
}

/**
 * The review is live on GitHub; this is the session's own bookkeeping. A
 * failure here is logged, never an error response — that would invite a
 * retry that posts the review twice.
 */
async function recordSubmittedDrafts(
  c: Context<AuthzEnv>,
  resolved: Awaited<ReturnType<typeof resolveSessionWrite>>,
  drafts: readonly { id: bigint }[],
  reviewId: bigint,
) {
  try {
    const recorded = await resolved.run(async (writer) => {
      await writer.publishDraftComments(drafts.map((row) => row.id));
      await writer.recordSubmittedReview({ githubReviewId: reviewId });
    });
    if (!recorded.ok) {
      if (recorded.error.kind === "session-rejected") {
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

export default function createHandlers(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
) {
  /** Post ONE grouped formal review with the VIEWER's token. */
  const submitReview = async (c: Context<AuthzEnv>) => {
    const parsedBody = submitBodySchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedBody.success || !parsedPr.success) {
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }
    const submitBody = parsedBody.data;

    const ctx = c.get("ctx");
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(c.get("repoId"), parsedPr.data);
    if (pr === undefined) {
      throw new NotFound(ApiErrorCode.NOT_FOUND);
    }

    // The session answers before a GitHub call is spent: a frozen tab is
    // refused here, and the drafts to publish are read off its rows.
    const resolved = await resolveSessionWrite(deps, c);
    const commitId = commitShaSchema.safeParse(resolved.head);
    if (!commitId.success) {
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }
    const drafts = await resolveSubmittableDrafts(c, resolved);
    const comments = drafts.map(shapeSubmitComment);
    assertSubmitRepresentable(submitBody, comments);

    // One refresh-once budget for the WHOLE request, shared across the fresh
    // slug resolve, the anchored attempt, AND the degradation retry.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const target = await resolveRepoOwnerAndName({ github }, c.get("repoId"));
    if (!target.ok) {
      throwRepoResolveFailure(target.error);
    }

    const created = await reviewController.submitReview(
      { github },
      {
        base: {
          owner: target.value.owner,
          repo: target.value.repo,
          prNumber: pr.prNumber,
          commitId: commitId.data,
          event: OUTCOME_TO_EVENT[submitBody.outcome],
        },
        body: submitBody.body,
        comments,
      },
    );
    if (!created.ok) {
      throwSubmitFailure(created.error);
    }

    // The review is on GitHub: the drafts it carried are published, and the
    // review id is what the session's own comments join on. A failure here
    // leaves drafts that are already posted — logged, never an error
    // response, which would invite a second review.
    // Nothing past this line may reach the error path: the review is live,
    // and an error response would invite a retry that posts it twice.
    stampAuditTarget(c, "pull_request", pr.id);
    await recordSubmittedDrafts(c, resolved, drafts, created.value.reviewId);

    // A submitted review is a conversation write — the cached conversation
    // is stale the moment it lands.
    evictConversation(ctx.installationId, c.get("repoId"), pr.prNumber);

    return c.json(
      {
        reviewId: Number(created.value.reviewId),
        commentsDegraded: created.value.commentsDegraded,
      },
      201,
      NO_STORE,
    );
  };

  return { submitReview };
}
