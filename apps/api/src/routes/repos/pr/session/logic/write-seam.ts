// The shared session write seam: the session op handlers plus the comments
// and review-submit routes all reach the same session through these two
// functions, bind the write to the access step's row, and map the store's
// refusals onto the wire as throws.
import type { Context } from "hono";
import { ReviewSessionErrorCodes } from "persistence";
import { ApiErrorCodes } from "contract";
import {
  BadRequest,
  Conflict,
  InternalError,
  NotFound,
} from "../../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../../auth/session/types";
import type { PullRequestEnv } from "../../../../../access/types";
import { sessionController, type ResolvedSessionWrite } from "../controller";
import { spanQuerySchema } from "../schemas";
import type { SessionWriteFailure } from "../types";

/**
 * Bind the write to the Brief the request names on the access step's row,
 * throwing the wire posture: a bad span is the deterministic 400, an unknown
 * Brief the subtree's hint-free 404.
 */
export async function resolveSessionWrite(
  deps: AuthRouteDeps,
  c: Context<PullRequestEnv>,
): Promise<ResolvedSessionWrite> {
  const span = spanQuerySchema.safeParse({
    base: c.req.query("base"),
    head: c.req.query("head"),
  });
  if (!span.success) {
    throw new BadRequest();
  }
  const access = c.get("pullRequestAccess");
  const resolved = await sessionController.resolveWrite(deps, {
    ctx: access.rowScope,
    pullRequestId: access.row.id,
    span: span.data,
    reviewerId: access.session.reviewerId,
    log: c.get("logger"),
  });
  if (!resolved.ok) {
    throw new NotFound();
  }
  return resolved.value;
}

/**
 * The store's expected refusals, mapped to the wire. An unreadable Brief is a
 * retryable 500, never empty facts that would drop carried decisions.
 */
export function throwSessionWriteFailure(failure: SessionWriteFailure): never {
  switch (failure.error.code) {
    case ReviewSessionErrorCodes.BRIEF_UNREADABLE:
      throw new InternalError();
    case ReviewSessionErrorCodes.SESSION_FROZEN:
      throw new Conflict(ApiErrorCodes.PR_CHANGED_SINCE_READ);
    case ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED:
      throw new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED);
    case ReviewSessionErrorCodes.DRAFT_LIMIT_REACHED:
      throw new Conflict(ApiErrorCodes.DRAFT_LIMIT_REACHED);
    case ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED:
      throw new Conflict(ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED);
    case ReviewSessionErrorCodes.DRAFT_ANCHOR_ORPHANED:
      throw new Conflict(ApiErrorCodes.DRAFT_ANCHOR_ORPHANED);
    case ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING:
      throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_PENDING);
    case ReviewSessionErrorCodes.DRAFT_PUBLISH_IN_DOUBT:
      throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT);
    case ReviewSessionErrorCodes.DRAFT_NOT_FOUND:
    case ReviewSessionErrorCodes.PARENT_NOT_IN_TENANT:
    case ReviewSessionErrorCodes.SESSION_NOT_FOUND:
      throw new NotFound();
  }
}
