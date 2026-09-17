// The `/auth` subtree: composition only. OAuth login + logout, the
// browser-only token-management surface, and the multi-org session pair.
import type { AuthzEnv } from "../authz";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { installationsRoutes } from "./installations";
import { logoutRoute } from "./logout";
import { oauthRoute } from "./oauth";
import { sessionProbeRoute } from "./session-probe";
import type { AuthRouteDeps } from "./session";
import { tokensRoutes } from "./tokens";

export function authRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  app.route("/github", oauthRoute(deps));
  app.route("/logout", logoutRoute(deps));
  app.route("/session", sessionProbeRoute(deps));
  app.route("/tokens", tokensRoutes(deps));
  app.route("/installations", installationsRoutes(deps));
  return app;
}
