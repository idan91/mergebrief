import type { Context } from "hono";
import type { Logger } from "logging";
import type { AuthzEnv } from "../../../access/types";
import type { AuthRouteDeps, ViewerPrincipal } from "../session/types";

export interface SessionsControllerDeps {
  readonly deps: AuthRouteDeps;
  readonly session: ViewerPrincipal;
  readonly log: Logger;
}

/** How many of the reviewer's sessions went, the caller's own included. */
export interface RevokedSessions {
  readonly revoked: number;
}

export interface SessionsHandlers {
  readonly revokeAll: (c: Context<AuthzEnv>) => Promise<Response>;
}
