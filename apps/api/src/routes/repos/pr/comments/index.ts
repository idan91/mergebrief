// The /comments write family behind the pr subtree's shared gate:
//   POST /, publish one held draft comment
//   POST /:commentId/replies, reply to a review comment
//   POST /:commentId/{resolve,unresolve}, flip a thread's state
// All run with the VIEWER's token (authorship stays the reviewer's), NOT
// gated on viewerIsAuthor or draft: GitHub separately authorizes each
// write. Every one IS a conversation write, success calls the injected
// `evictConversation` hook.
import {
  ProductActionIds,
  type PostedCommentResponse,
  type ThreadResolutionResponse,
} from "contract";
import type { Context, Handler } from "hono";
import { HttpStatuses, type Mutable } from "types";
import type { PullRequestEnv } from "../../../../access/types";
import { stampAuditTarget } from "../../../../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { BadRequest } from "../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { commitShaSchema } from "../../../wire-bounds";
import { resolveSessionWrite } from "../session/logic/write-seam";
import { spanQuerySchema } from "../session/schemas";
import {
  throwPostNowFailure,
  throwReplyFailure,
  throwResolutionFailure,
} from "./logic/wire-failures";
import { postDraftNow } from "./post-now";
import { replyToComment } from "./reply-to-comment";
import { setThreadResolution } from "./resolve-thread";
import {
  commentIdSchema,
  publishDraftSchema,
  replyBodySchema,
} from "./schemas";
import type { EvictConversation, ReplyInput } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The request body, or `undefined` when it is not JSON at all. */
async function readJsonBody(c: Context<PullRequestEnv>) {
  return c.req.json().catch(() => undefined);
}

/** The cached conversation goes stale with any write on it. */
function evictFor(
  c: Context<PullRequestEnv>,
  evictConversation: EvictConversation,
): void {
  const access = c.get("pullRequestAccess");
  evictConversation(access.rowScope, access.repoId, access.prNumber);
}

function createPostNowHandler(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): Handler<PullRequestEnv> {
  return async (c) => {
    const parsed = publishDraftSchema.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new BadRequest();
    }
    const session = await resolveSessionWrite(deps, c);
    const commitId = commitShaSchema.safeParse(session.head);
    if (!commitId.success) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const posted = await postDraftNow(c.get("logger"), access, {
      session,
      draftId: parsed.data.draftId,
      commitId: commitId.data,
    });
    if (!posted.ok) {
      throwPostNowFailure(posted.error, access.footing);
    }

    evictFor(c, evictConversation);
    const { commentId, reviewId } = posted.value;
    stampAuditTarget(c, "review_comment", commentId);
    const body: Mutable<PostedCommentResponse> = {
      commentId: Number(commentId),
    };
    if (reviewId !== undefined) {
      body.reviewId = Number(reviewId);
    }
    return c.json(body, HttpStatuses.CREATED, NO_STORE);
  };
}

function createReplyHandler(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): Handler<PullRequestEnv> {
  return async (c) => {
    const parsedBody = replyBodySchema.safeParse(await readJsonBody(c));
    const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
    if (!parsedBody.success || !parsedComment.success) {
      throw new BadRequest();
    }
    const input: Mutable<ReplyInput> = {
      commentId: parsedComment.data,
      body: parsedBody.data.body,
    };
    const span = spanQuerySchema.safeParse({
      base: c.req.query("base"),
      head: c.req.query("head"),
    });
    if (span.success) {
      input.span = span.data;
    }

    const access = c.get("pullRequestAccess");
    const created = await replyToComment(deps, c.get("logger"), access, input);
    if (!created.ok) {
      throwReplyFailure(created.error, access.footing);
    }

    evictFor(c, evictConversation);
    const { commentId, reviewId } = created.value;
    stampAuditTarget(c, "review_comment", BigInt(commentId));
    const body: Mutable<PostedCommentResponse> = { commentId };
    if (reviewId !== undefined) {
      body.reviewId = reviewId;
    }
    return c.json(body, HttpStatuses.CREATED, NO_STORE);
  };
}

function createResolutionHandler(
  evictConversation: EvictConversation,
  resolved: boolean,
): Handler<PullRequestEnv> {
  return async (c) => {
    const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
    if (!parsedComment.success) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const rootCommentId = parsedComment.data;
    const outcome = await setThreadResolution(access, {
      rootCommentId,
      resolved,
    });
    if (!outcome.ok) {
      throwResolutionFailure(outcome.error, access.footing);
    }

    // Changed or confirmed on GitHub: the cached conversation is stale
    // either way, so the FE's refetch shows the transition at once.
    evictFor(c, evictConversation);
    stampAuditTarget(c, "review_comment", BigInt(rootCommentId));
    const body: ThreadResolutionResponse = {
      resolved,
      alreadyInTargetState: outcome.value.alreadyInTargetState,
    };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };
}

export function commentWriteRoutes(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.action(
    {
      id: ProductActionIds.CREATE_INLINE_COMMENT,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/",
    createPostNowHandler(deps, evictConversation),
  );
  app.action(
    {
      id: ProductActionIds.REPLY_TO_COMMENT,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/:commentId/replies",
    createReplyHandler(deps, evictConversation),
  );
  app.action(
    {
      id: ProductActionIds.RESOLVE_THREAD,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/:commentId/resolve",
    createResolutionHandler(evictConversation, true),
  );
  app.action(
    {
      id: ProductActionIds.UNRESOLVE_THREAD,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/:commentId/unresolve",
    createResolutionHandler(evictConversation, false),
  );
  return app;
}
