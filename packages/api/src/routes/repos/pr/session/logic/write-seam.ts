// The HTTP seam the session writes share: parse the named span, bind the
// write through the controller, and map its refusals onto the wire. The
// comments and review-submit handlers reach the same session through here.
import type { Context } from "hono";
import { ReviewSessionErrorCode } from "persistence";
import { ApiErrorCode } from "../../../../../error-response";
import {
  BadRequest,
  Conflict,
  InternalError,
  NotFound,
} from "../../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../../auth/session";
import type { AuthzEnv } from "../../../../authz";
import { prNumberSchema } from "../../wire-bounds";
import sessionController from "../controller";
import { spanQuerySchema } from "../schemas";
import type { SessionWriteFailure } from "../types";

/**
 * Resolve the PR and the Brief the request names, throwing the wire posture:
 * a bad span is the deterministic 400, an unknown PR/Brief the subtree's
 * hint-free 404.
 */
export async function resolveSessionWrite(
  deps: AuthRouteDeps,
  c: Context<AuthzEnv>,
) {
  const span = spanQuerySchema.safeParse({
    base: c.req.query("base"),
    head: c.req.query("head"),
  });
  const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
  if (!span.success || !prNumber.success) {
    throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
  }
  const resolved = await sessionController.resolveWrite(deps, {
    ctx: c.get("ctx"),
    repoId: c.get("repoId"),
    prNumber: prNumber.data,
    span: span.data,
    reviewerId: c.get("session").reviewerId,
    log: c.get("logger"),
  });
  if (!resolved.ok) {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  return resolved.value;
}

/** The store's expected refusals, mapped to the wire. */
export function throwSessionWriteFailure(failure: SessionWriteFailure): never {
  if (failure.kind === "unreadable-brief") {
    throw new InternalError(ApiErrorCode.INTERNAL_ERROR);
  }
  if (failure.error.code === ReviewSessionErrorCode.SESSION_FROZEN) {
    throw new Conflict(ApiErrorCode.PR_CHANGED_SINCE_READ);
  }
  throw new NotFound(ApiErrorCode.NOT_FOUND);
}
