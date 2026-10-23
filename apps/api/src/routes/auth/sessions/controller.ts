// Hono-free. The reviewer id is the signed-in principal's, never a request
// field, so the delete reaches only the caller's own sessions.
import type { RevokeSessionsResponse } from "contract";
import { createSessionAuth } from "persistence";
import { revokeOrphanedGrantsAtGitHub } from "../session/logic/revoke-at-github";
import type { SessionsControllerDeps } from "./types";

export const sessionsController = {
  async revokeAll({
    deps,
    session,
    log,
  }: SessionsControllerDeps): Promise<RevokeSessionsResponse> {
    const deleted = await createSessionAuth(
      deps.handle,
    ).deleteSessionsForReviewer(session.reviewerId);
    await revokeOrphanedGrantsAtGitHub(deps, deleted.orphanedGrants, log);
    return { revoked: deleted.deleted };
  },
};
