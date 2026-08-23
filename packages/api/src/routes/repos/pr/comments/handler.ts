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
import type { AuthRouteDeps } from "../../../auth/session";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthzEnv } from "../../../authz";
import { prNumberSchema } from "../wire-bounds";
import { commitShaSchema } from "../wire-bounds";
import {
  mapWriteFailure,
  resolveWrite,
  type ResolvedWrite,
} from "../session/write-resolve";
import commentsController from "./controller";
import {
  throwPublishFailure,
  throwReplyFailure,
  throwRepoResolveFailure,
  throwResolutionFailure,
} from "./logic/wire-failures";
import type { EvictConversation } from "./types";
import {
  publishDraftSchema,
  commentIdSchema,
  replyBodySchema,
} from "./schemas";
import { readDraftAnchor } from "./logic/draft-anchor";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The request body, or `undefined` when it is not JSON at all. */
async function readJsonBody(c: Context<AuthzEnv>) {
  return c.req.json().catch(() => undefined);
}

/**
 * The draft this session holds under `draftId`, already proven publishable:
 * unknown -> the subtree's hint-free 404, published -> 409, orphaned anchor
 * -> the distinct 409 the submit path uses. A session refusal renders via
 * `mapWriteFailure` and comes back as the ready Response.
 */
async function resolvePublishableDraft(
  c: Context<AuthzEnv>,
  resolved: Extract<ResolvedWrite, { ok: true }>,
  draftId: bigint,
) {
  const held = await resolved.run(async (writer) =>
    (await writer.draftComments()).find(
      (row) => row.id === draftId || row.carriedFromCommentId === draftId,
    ),
  );
  if (!held.ok) {
    return mapWriteFailure(c, held.error);
  }
  const draft = held.value;
  if (draft === undefined) {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  if (draft.status === DraftCommentStatus.SUBMITTED) {
    throw new Conflict(ApiErrorCode.DRAFT_ALREADY_PUBLISHED);
  }
  // Same refusal the submit makes, for the same reason: an orphaned anchor
  // would land the comment on unrelated lines, and posting one at a time
  // has no degradation fold to catch it. Re-anchor or delete to clear it.
  if (draft.anchorStatus === AnchorStatus.ORPHANED) {
    throw new Conflict(ApiErrorCode.DRAFT_ANCHOR_ORPHANED);
  }
  return draft;
}

/**
 * The GitHub write is the commit point; flipping the row is how the session
 * records it. A failure here leaves a draft that is on GitHub — logged,
 * never an error response, which would invite a second post.
 */
async function recordPublishedDraft(
  c: Context<AuthzEnv>,
  resolved: Extract<ResolvedWrite, { ok: true }>,
  draftRowId: bigint,
  commentId: bigint,
) {
  try {
    const flipped = await resolved.run((writer) =>
      writer.publishDraftComments([draftRowId]),
    );
    if (!flipped.ok) {
      throw new Error(flipped.error.code);
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

export default function createHandlers(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
) {
  /** Publish one held draft comment with the VIEWER's token. */
  const publishInlineComment = async (c: Context<AuthzEnv>) => {
    const parsedBody = publishDraftSchema.safeParse(await readJsonBody(c));
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedBody.success || !parsedPr.success) {
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }
    const draftId = parsedBody.data.draftId;

    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      throw new NotFound(ApiErrorCode.NOT_FOUND);
    }

    // The session answers first, and it answers with no GitHub call spent:
    // a frozen tab, an unknown draft and one already published are all
    // decided off rows this server holds.
    const resolved = await resolveWrite(deps, c);
    if (!resolved.ok) {
      return resolved.response;
    }
    const commitId = commitShaSchema.safeParse(resolved.head);
    if (!commitId.success) {
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }
    const draft = await resolvePublishableDraft(c, resolved, draftId);
    if (draft instanceof Response) {
      return draft;
    }

    // ONE client instance: the refresh budget spans the fresh slug resolve
    // AND the write.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const target = await commentsController.resolveFreshRepoTarget(
      { github },
      repoId,
    );
    if (!target.ok) {
      throwRepoResolveFailure(target.error);
    }

    const posted = await commentsController.postInlineComment(
      { github },
      {
        owner: target.value.owner,
        repo: target.value.repo,
        prNumber: pr.prNumber,
        commitId: commitId.data,
        ...readDraftAnchor(draft),
        body: draft.body,
      },
    );
    if (!posted.ok) {
      throwPublishFailure(posted.error);
    }

    await recordPublishedDraft(c, resolved, draft.id, posted.value.commentId);
    evictConversation(ctx.installationId, repoId, pr.prNumber);
    stampAuditTarget(c, "review_comment", posted.value.commentId);

    if (posted.value.reviewId === undefined) {
      return c.json(
        { commentId: Number(posted.value.commentId) },
        201,
        NO_STORE,
      );
    }
    return c.json(
      {
        commentId: Number(posted.value.commentId),
        reviewId: Number(posted.value.reviewId),
      },
      201,
      NO_STORE,
    );
  };

  /** Reply to a review comment with the VIEWER's token. */
  const replyToComment = async (c: Context<AuthzEnv>) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }
    const parsedBody = replyBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
    if (!parsedPr.success || !parsedComment.success) {
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }

    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      throw new NotFound(ApiErrorCode.NOT_FOUND);
    }

    // One refresh budget per REQUEST, shared across both GitHub calls.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const target = await commentsController.resolveFreshRepoTarget(
      { github },
      repoId,
    );
    if (!target.ok) {
      throwRepoResolveFailure(target.error);
    }

    const created = await commentsController.postReply(
      { github },
      {
        owner: target.value.owner,
        repo: target.value.repo,
        prNumber: pr.prNumber,
        commentId: parsedComment.data,
        body: parsedBody.data.body,
      },
    );
    if (!created.ok) {
      throwReplyFailure(created.error);
    }

    // The write happened: the cached conversation is stale — drop it so the
    // FE's post-reply refetch reflects the reply inside the TTL.
    evictConversation(ctx.installationId, repoId, pr.prNumber);

    stampAuditTarget(c, "review_comment", BigInt(created.value.commentId));

    return c.json({ commentId: created.value.commentId }, 201, NO_STORE);
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
      throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
    }

    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      throw new NotFound(ApiErrorCode.NOT_FOUND);
    }

    // One refresh-once budget per REQUEST, shared across every GitHub call.
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const target = await commentsController.resolveFreshRepoTarget(
      { github },
      repoId,
    );
    if (!target.ok) {
      throwRepoResolveFailure(target.error);
    }

    const outcome = await commentsController.setThreadResolution(
      { github },
      {
        owner: target.value.owner,
        repo: target.value.repo,
        prNumber: pr.prNumber,
        rootCommentId: parsedComment.data,
        resolved,
      },
    );
    if (!outcome.ok) {
      throwResolutionFailure(outcome.error);
    }

    // The thread state changed (or was confirmed) on GitHub: the cached
    // conversation is stale either way — drop it so the FE's refetch shows
    // the slim-row transition immediately.
    evictConversation(ctx.installationId, repoId, pr.prNumber);

    stampAuditTarget(c, "review_comment", BigInt(parsedComment.data));

    return c.json(
      { resolved, alreadyInTargetState: outcome.value.alreadyInTargetState },
      200,
      NO_STORE,
    );
  };
}
