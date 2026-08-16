// The `/auth` subtree — composition only. OAuth login + logout, the
// browser-only token-management surface, and the multi-org session pair.
import { Hono } from "hono";
import type { AuthzEnv } from "../authz";
import { installationsRoute } from "./installations";
import { logoutRoute } from "./logout";
import { oauthRoute } from "./oauth";
import type { AuthRouteDeps } from "./session";
import { tokensRoute } from "./tokens";

export function authRoutes(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  app.route("/github", oauthRoute(deps));
  app.route("/logout", logoutRoute(deps));
  app.route("/tokens", tokensRoute(deps));
  app.route("/installations", installationsRoute(deps));
  return app;
}
