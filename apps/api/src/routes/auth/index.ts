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
import { sessionRoute } from "./session";
import type { AuthRouteDeps } from "./session/types";
import { tokensRoutes } from "./tokens";
import type { AccessibleInstallationsResolver } from "./accessible-installations";

export function authRoutes(
  deps: AuthRouteDeps,
  installations: AccessibleInstallationsResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  app.route("/github", oauthRoute(deps));
  app.route("/logout", logoutRoute(deps));
  app.route("/session", sessionRoute(deps));
  app.route("/tokens", tokensRoutes(deps, installations));
  app.route("/installations", installationsRoutes(deps, installations));
  return app;
}
