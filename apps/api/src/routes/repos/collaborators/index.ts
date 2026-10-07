// The collaborators surface: one gated live-fetch GET, the @mention
// autocomplete pool. Fetched from GitHub with the INSTALLATION token, since
// the gate already proved repo access and a shared token means one rate
// budget and one cache entry per repo. 60s positive TTL, `no-store`, nothing
// persisted.
//
// GUARD, `viewerCanPush`: GitHub denies the roster to viewers without push
// access, so serving it on the installation token would leak logins and names
// to any read-access viewer. Non-push viewers get the gate's 404 first.
import type { InstallationResolver } from "../../installation-resolver";
import type { AuthRouteDeps } from "../../auth/session/types";
import { createAuthzMiddleware, type AuthzEnv } from "../../authz";
import type { InstallationGitHubPort } from "../../github-port";
import { createTtlCache } from "../../ttl-cache";
import { ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import { COLLABORATORS_CACHE_MAX_ENTRIES } from "./consts";
import { createCollaboratorsHandlers } from "./handler";

export interface CollaboratorsRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
}

/** Mount the collaborators read behind its own per-repo gate instance. */
export function collaboratorsRoute(
  deps: CollaboratorsRouteDeps,
  installations: InstallationResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const authz = createAuthzMiddleware(deps, installations);
  // Serialized response bodies, keyed installation:repo (shared across every
  // viewer, the point of the installation-token read).
  const cache = createTtlCache<string>(COLLABORATORS_CACHE_MAX_ENTRIES);

  const handlers = createCollaboratorsHandlers(deps.github, cache);

  app.use("/", authz);
  app.query(
    {
      id: ProductQueryIds.LIST_COLLABORATORS,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listCollaborators,
  );
  return app;
}
