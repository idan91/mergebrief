// Hono-free. An owner-world write: the scope narrows the delete to the
// reviewer's own rows, and a grant dies only when no session and no API
// token references it, so a token minted off one of these sessions lives on.
import type { RevokeSessionsResponse } from "contract";
import { createTenantRepository } from "persistence";
import type { SessionsControllerDeps } from "./types";

export const sessionsController = {
  async revokeAll({
    deps,
    session,
  }: SessionsControllerDeps): Promise<RevokeSessionsResponse> {
    const revoked = await createTenantRepository(deps.handle, {
      ownerUserId: session.reviewerId,
    }).sessions.deleteByReviewer(session.reviewerId);
    return { revoked };
  },
};
