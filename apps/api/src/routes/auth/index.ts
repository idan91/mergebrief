// The `/auth` subtree: composition only. OAuth login + logout, the session
// probe, the revoke-all and the browser-only token-management surface.
import type { AuthzEnv } from "../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { logoutRoute } from "./logout";
import { oauthRoute } from "./oauth";
import { sessionRoute } from "./session";
import { sessionsRoutes } from "./sessions";
import type { AuthRouteDeps } from "./session/types";
import { tokensRoutes } from "./tokens";

export function authRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  app.route("/github", oauthRoute(deps));
  app.route("/logout", logoutRoute(deps));
  app.route("/session", sessionRoute(deps));
  app.route("/sessions", sessionsRoutes(deps));
  app.route("/tokens", tokensRoutes(deps));
  return app;
}
