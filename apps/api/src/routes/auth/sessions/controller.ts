// Hono-free. The reviewer id is the signed-in principal's, never a request
// field, so the delete reaches only the caller's own sessions.
import type { RevokeSessionsResponse } from "contract";
import { createSessionAuth } from "persistence";
import type { SessionsControllerDeps } from "./types";

export const sessionsController = {
  async revokeAll({
    deps,
    session,
  }: SessionsControllerDeps): Promise<RevokeSessionsResponse> {
    const revoked = await createSessionAuth(
      deps.handle,
    ).deleteSessionsForReviewer(session.reviewerId);
    return { revoked };
  },
};
