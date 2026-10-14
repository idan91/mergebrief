import type { Context } from "hono";
import type { Logger } from "logging";
import type { AuthzEnv } from "../../../access/types";
import type { AuthRouteDeps, ViewerPrincipal } from "../session/types";

export interface SessionsControllerDeps {
  readonly deps: AuthRouteDeps;
  readonly session: ViewerPrincipal;
  readonly log: Logger;
}

export interface SessionsHandlers {
  readonly revokeAll: (c: Context<AuthzEnv>) => Promise<Response>;
}
