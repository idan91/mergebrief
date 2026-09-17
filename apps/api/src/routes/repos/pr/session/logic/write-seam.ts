// The shared session write seam: the session op handlers plus the comments
// and review-submit handlers all reach the same session through these two
// functions, resolve the write target, and map the store's refusals onto
// the wire as throws.
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
import type { AuthzEnv } from "../../../../authz";
import { prNumberSchema } from "../../wire-bounds";
import sessionController from "../controller";
import { spanQuerySchema } from "../schemas";
import type { SessionWriteFailure } from "../types";
import { resolvePrScopeFrom } from "../../scope";

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
    throw new BadRequest();
  }
  const resolved = await sessionController.resolveWrite(deps, {
    ctx: await resolvePrScopeFrom(c, deps.handle, prNumber.data),
    repoId: c.get("repoId"),
    prNumber: prNumber.data,
    span: span.data,
    reviewerId: c.get("session").reviewerId,
    log: c.get("logger"),
  });
  if (!resolved.ok) {
    throw new NotFound();
  }
  return resolved.value;
}

/** The store's expected refusals, mapped to the wire. */
export function throwSessionWriteFailure(failure: SessionWriteFailure): never {
  if (failure.kind === "unreadable-brief") {
    throw new InternalError();
  }
  if (failure.error.code === ReviewSessionErrorCodes.SESSION_FROZEN) {
    throw new Conflict(ApiErrorCodes.PR_CHANGED_SINCE_READ);
  }
  throw new NotFound();
}
