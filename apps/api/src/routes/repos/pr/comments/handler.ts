import type { Context } from "hono";
import {
  ReviewSessionErrorCodes,
  createTenantRepository,
  type PublishedDraftsInput,
  type ScopeContext,
} from "persistence";
import { AnchorStatuses, DraftCommentStatuses } from "types/comments";
import type { Mutable } from "types/utils";
import { ApiErrorCodes } from "contract";
import type { InlineReviewCommentResult } from "github";
import {
  BadRequest,
  Conflict,
  NotFound,
} from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthzEnv } from "../../../authz";
import { commitShaSchema, prNumberSchema } from "../../../wire-bounds";
import {
  resolveSessionWrite,
  throwSessionWriteFailure,
} from "../session/logic/write-seam";
import {
  sessionController,
  type ExistingSessionWriteFailure,
} from "../session/controller";
import { spanQuerySchema } from "../session/schemas";
import { commentsController } from "./controller";
import {
  throwPublishFailure,
  throwReplyFailure,
  throwResolutionFailure,
} from "./logic/wire-failures";
import type { EvictConversation } from "./types";
import {
  publishDraftSchema,
  commentIdSchema,
  replyBodySchema,
} from "./schemas";
import {
  resolveRepoOwnerAndName,
  throwRepoResolveFailure,
} from "../../logic/resolve-repo-owner-and-name";
import { shapeInlineCommentWrite } from "./logic/draft-anchor";
import { resolvePrScopeFrom } from "../scope";
import { FailureKinds } from "../../../../shared-errors/failures";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The request body, or `undefined` when it is not JSON at all. */
async function readJsonBody(c: Context<AuthzEnv>) {
  return c.req.json().catch(() => undefined);
}

/**
 * The draft this session holds under `draftId`, already proven publishable:
 * unknown -> the subtree's hint-free 404, published -> 409, orphaned anchor
 * -> the distinct 409 the submit path uses. A session refusal renders via
 * a session-store refusal maps through `throwSessionWriteFailure`.
 */
async function resolvePublishableDraft(
  c: Context<AuthzEnv>,
  resolved: Awaited<ReturnType<typeof resolveSessionWrite>>,
  draftId: bigint,
) {
  const held = await resolved.publish.listDrafts();
  if (!held.ok) {
    throwSessionWriteFailure(held.error);
  }
  const draft = held.value.find(
    (row) => row.id === draftId || row.carriedFromCommentId === draftId,
  );
  if (draft === undefined) {
    throw new NotFound();
  }
  if (draft.status === DraftCommentStatuses.SUBMITTED) {
    throw new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED);
  }
  // Same refusal the submit makes, for the same reason: an orphaned anchor
  // would land the comment on unrelated lines, and posting one at a time
  // has no degradation fold to catch it. Re-anchor or delete to clear it.
  if (draft.anchorStatus === AnchorStatuses.ORPHANED) {
    throw new Conflict(ApiErrorCodes.DRAFT_ANCHOR_ORPHANED);
  }
  return draft;
}

/**
 * The GitHub write is the commit point; flipping the row is how the session
 * records it, and the wrapping review id is how a later read knows the
 * comment as the reviewer's own. A failure here leaves a draft that is on
 * GitHub, logged, never an error response, which would invite a second post.
 */
async function recordPublishedDraft(
  c: Context<AuthzEnv>,
  resolved: Awaited<ReturnType<typeof resolveSessionWrite>>,
  draftRowId: bigint,
  posted: InlineReviewCommentResult,
) {
  const { commentId, reviewId } = posted;
  const published: Mutable<PublishedDraftsInput> = { draftIds: [draftRowId] };
  if (reviewId !== undefined) {
    published.githubReviewId = reviewId;
  }
  try {
    const flipped = await resolved.publish.recordPublishedDrafts(published);
    if (!flipped.ok) {
      if (flipped.error.kind === FailureKinds.SESSION_REJECTED) {
        throw new Error(flipped.error.error.code);
      }
      throw new Error(flipped.error.kind);
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

/** Refusals a reply meets in ordinary use: nothing is wrong, nothing to alert on. */
function isOrdinaryReplyRecordRefusal(
  failure: ExistingSessionWriteFailure,
): boolean {
  if (failure.kind === "target-not-found" || failure.kind === "no-session") {
    return true;
  }
  return (
    failure.kind === FailureKinds.SESSION_REJECTED &&
    failure.error.code === ReviewSessionErrorCodes.SESSION_FROZEN
  );
}

/**
 * The reply is already on GitHub. When the request names the Brief it was
 * written from and the reviewer holds a session there, the wrapping review id
 * is recorded on it, so a later read knows the reply as the reviewer's own.
 * It never creates a session, and a refusal never reaches the response.
 */
async function recordReplyReview(
  deps: AuthRouteDeps,
  c: Context<AuthzEnv>,
  target: { readonly ctx: ScopeContext; readonly prNumber: number },
  reviewId: number,
) {
  const span = spanQuerySchema.safeParse({
    base: c.req.query("base"),
    head: c.req.query("head"),
  });
  if (!span.success) return;

  const log = c.get("logger");
  try {
    const recorded = await sessionController.recordReplyReview(
      deps,
      {
        ctx: target.ctx,
        repoId: c.get("repoId"),
        prNumber: target.prNumber,
        span: span.data,
        reviewerId: c.get("session").reviewerId,
        log,
      },
      BigInt(reviewId),
    );
    if (recorded.ok) return;

    const reason =
      recorded.error.kind === FailureKinds.SESSION_REJECTED
        ? recorded.error.error.code
        : recorded.error.kind;
    const fields = { reviewId: String(reviewId), reason };
    if (isOrdinaryReplyRecordRefusal(recorded.error)) {
      log.debug("reply review id not recorded", fields);
    } else {
      log.warn("reply review id stayed unrecorded", fields);
    }
  } catch (recordError) {
    log.error("reply review id stayed unrecorded", {
      reviewId: String(reviewId),
      err: recordError,
    });
  }
}

export function createCommentsHandlers(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
) {
  /** Publish one held draft comment with the VIEWER's token. */
  const publishInlineComment = async (c: Context<AuthzEnv>) => {
    const parsedBody = publishDraftSchema.safeParse(await readJsonBody(c));
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedBody.success || !parsedPr.success) {
      throw new BadRequest();
    }
    const draftId = parsedBody.data.draftId;

    const ctx = await resolvePrScopeFrom(c, deps.handle, parsedPr.data);
    const repoId = c.get("repoId");
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      throw new NotFound();
    }

    // The session answers first, and it answers with no GitHub call spent:
    // a frozen tab, an unknown draft and one already published are all
    // decided off rows this server holds.
    const resolved = await resolveSessionWrite(deps, c);
    const commitId = commitShaSchema.safeParse(resolved.head);
    if (!commitId.success) {
      throw new BadRequest();
    }
    const draft = await resolvePublishableDraft(c, resolved, draftId);

    // ONE client instance: the refresh budget spans the fresh slug resolve
    // AND the write.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const resolvedName = await resolveRepoOwnerAndName({ github }, repoId);
    if (!resolvedName.ok) {
      throwRepoResolveFailure(resolvedName.error, c.get("urlBoxOnly") === true);
    }

    const posted = await commentsController.postInlineComment(
      { github },
      shapeInlineCommentWrite(draft, {
        owner: resolvedName.value.owner,
        repo: resolvedName.value.repo,
        prNumber: pr.prNumber,
        commitId: commitId.data,
      }),
    );
    if (!posted.ok) {
      throwPublishFailure(posted.error);
    }

    await recordPublishedDraft(c, resolved, draft.id, posted.value);
    evictConversation(ctx, repoId, pr.prNumber);
    stampAuditTarget(c, "review_comment", posted.value.commentId);

    if (posted.value.reviewId === undefined) {
      return c.json(
        { commentId: Number(posted.value.commentId) },
        HttpStatuses.CREATED,
        NO_STORE,
      );
    }
    return c.json(
      {
        commentId: Number(posted.value.commentId),
        reviewId: Number(posted.value.reviewId),
      },
      HttpStatuses.CREATED,
      NO_STORE,
    );
  };

  /** Reply to a review comment with the VIEWER's token. */
  const replyToComment = async (c: Context<AuthzEnv>) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw new BadRequest();
    }
    const parsedBody = replyBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      throw new BadRequest();
    }
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
    if (!parsedPr.success || !parsedComment.success) {
      throw new BadRequest();
    }

    const ctx = await resolvePrScopeFrom(c, deps.handle, parsedPr.data);
    const repoId = c.get("repoId");
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      throw new NotFound();
    }

    // One refresh budget per REQUEST, shared across both GitHub calls.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const resolvedName = await resolveRepoOwnerAndName({ github }, repoId);
    if (!resolvedName.ok) {
      throwRepoResolveFailure(resolvedName.error, c.get("urlBoxOnly") === true);
    }

    const created = await commentsController.postReply(
      { github },
      {
        owner: resolvedName.value.owner,
        repo: resolvedName.value.repo,
        prNumber: pr.prNumber,
        commentId: parsedComment.data,
        body: parsedBody.data.body,
      },
    );
    if (!created.ok) {
      throwReplyFailure(created.error);
    }

    // The write happened: the cached conversation is stale, drop it so the
    // FE's post-reply refetch reflects the reply inside the TTL.
    evictConversation(ctx, repoId, pr.prNumber);

    stampAuditTarget(c, "review_comment", BigInt(created.value.commentId));

    if (created.value.reviewId === undefined) {
      return c.json(
        { commentId: created.value.commentId },
        HttpStatuses.CREATED,
        NO_STORE,
      );
    }
    await recordReplyReview(
      deps,
      c,
      { ctx, prNumber: pr.prNumber },
      created.value.reviewId,
    );
    return c.json(
      {
        commentId: created.value.commentId,
        reviewId: created.value.reviewId,
      },
      HttpStatuses.CREATED,
      NO_STORE,
    );
  };

  return {
    publishInlineComment,
    replyToComment,
    resolveThread: setThreadResolution(deps, evictConversation, true),
    unresolveThread: setThreadResolution(deps, evictConversation, false),
  };
}

/** Flip a thread's resolution state with the VIEWER's token. */
function setThreadResolution(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
  resolved: boolean,
) {
  return async (c: Context<AuthzEnv>) => {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
    if (!parsedPr.success || !parsedComment.success) {
      throw new BadRequest();
    }

    const ctx = await resolvePrScopeFrom(c, deps.handle, parsedPr.data);
    const repoId = c.get("repoId");
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      throw new NotFound();
    }

    // One refresh-once budget per REQUEST, shared across every GitHub call.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const resolvedName = await resolveRepoOwnerAndName({ github }, repoId);
    if (!resolvedName.ok) {
      throwRepoResolveFailure(resolvedName.error, c.get("urlBoxOnly") === true);
    }

    const outcome = await commentsController.setThreadResolution(
      { github },
      {
        owner: resolvedName.value.owner,
        repo: resolvedName.value.repo,
        prNumber: pr.prNumber,
        rootCommentId: parsedComment.data,
        resolved,
      },
    );
    if (!outcome.ok) {
      throwResolutionFailure(outcome.error);
    }

    // The thread state changed (or was confirmed) on GitHub: the cached
    // conversation is stale either way, drop it so the FE's refetch shows
    // the slim-row transition immediately.
    evictConversation(ctx, repoId, pr.prNumber);

    stampAuditTarget(c, "review_comment", BigInt(parsedComment.data));

    return c.json(
      { resolved, alreadyInTargetState: outcome.value.alreadyInTargetState },
      HttpStatuses.OK,
      NO_STORE,
    );
  };
}
