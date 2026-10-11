import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { stampAuditTarget } from "../../../product-operations/audit";
import type { AuthzEnv } from "../../../access/types";
import { HOST_COOKIE_CLEAR, SESSION_COOKIE } from "../session/consts";
import type { AuthRouteDeps } from "../session/types";
import { sessionsController } from "./controller";
import type { SessionsHandlers } from "./types";
import { HttpStatuses } from "types/http";

// Per-viewer state, so `no-store`; error paths inherit it from `onError`.
const NO_STORE = { "cache-control": "no-store" } as const;
const AUDIT_TARGET_REVIEWER = "reviewer";

export function createSessionsHandlers(deps: AuthRouteDeps): SessionsHandlers {
  const revokeAll = async (c: Context<AuthzEnv>): Promise<Response> => {
    const session = c.get("session");
    const result = await sessionsController.revokeAll({
      deps,
      session,
      log: c.get("logger"),
    });

    stampAuditTarget(c, AUDIT_TARGET_REVIEWER, session.reviewerId);
    deleteCookie(c, SESSION_COOKIE, HOST_COOKIE_CLEAR);
    return c.json(
      { ok: true, revoked: result.revoked },
      HttpStatuses.OK,
      NO_STORE,
    );
  };

  return { revokeAll };
}
