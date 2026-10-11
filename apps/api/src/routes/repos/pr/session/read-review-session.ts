import type { SessionPayload } from "contract";
import { createTenantRepository } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { findSessionTarget } from "./logic/brief-target";
import { buildSessionPayload } from "./logic/payload";
import { rejectSession } from "./logic/session-writes";
import type {
  SessionRequestResult,
  SessionRequest,
  SessionStoreDeps,
} from "./types";

/**
 * The session read creates nothing. Before the first write the payload
 * carries the carry-over verdicts evaluated in memory, still writing nothing.
 */
export async function readReviewSession(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: SessionRequest,
): Promise<SessionRequestResult<SessionPayload>> {
  const target = await findSessionTarget(deps.handle, access, request.span);
  if (target === undefined) {
    return { ok: false, error: { kind: "target-not-found" } };
  }

  const sessions = createTenantRepository(
    deps.handle,
    access.rowScope,
  ).reviewSessions;
  const view = await sessions.preview({
    briefId: target.briefId,
    reviewerId: access.session.reviewerId,
  });
  if (!view.ok) {
    return rejectSession(deps.log, request.span, target, view.error);
  }
  return {
    ok: true,
    value: buildSessionPayload(view.value, target.headIndex),
  };
}
