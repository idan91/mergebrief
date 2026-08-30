// The collaborators surface: one gated live-fetch GET —
// GET /api/repos/:repoId/collaborators — the @mention autocomplete pool.
//
// Fetched from GitHub with the INSTALLATION token (the gate already proved
// the viewer's repo access; a shared token means one rate budget and ONE
// cache entry per repo). 60s positive TTL, response `no-store`, nothing
// persisted.
//
// GUARD — `viewerCanPush`: GitHub itself denies the roster to viewers without
// push access; serving it on the installation token would otherwise leak
// logins + names to any read-access viewer (on a public repo, anyone).
// Non-push viewers get the gate's 404 posture BEFORE any GitHub call.
import type { AuthRouteDeps } from "../../auth/session";
import { createAuthzMiddleware, type AuthzEnv } from "../../authz";
import type { InstallationGitHubPort } from "../../github-port";
import { createTtlCache } from "../../ttl-cache";
import { ProductQueryIds } from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WriteClassifications } from "../../../product-operations/types";
import { COLLABORATORS_CACHE_MAX_ENTRIES } from "./consts";
import createCollaboratorsHandlers from "./handler";

export interface CollaboratorsRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
}

/** Mount the collaborators read behind its own per-repo gate instance. */
export function collaboratorsRoute(
  deps: CollaboratorsRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);
  // Serialized response bodies, keyed installation:repo (shared across every
  // viewer — the point of the installation-token read).
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
