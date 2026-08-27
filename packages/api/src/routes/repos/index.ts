// The `/repos` subtree. `GET /` — owner/name → repoId resolution for the CLI:
// the installation∩user-access intersection via the SHARED allowed-set resolver
// (one cache with /pulls); `repoId` stringified (bigint is not JSON-native);
// a FLAT array, deliberately unpaginated (an installation's repo grant is a
// bounded set); `no-store` (per-viewer state); a GitHub failure is a 401/502 —
// never a DB-only fallback. Lives under `/api/*`, so both presentation channels
// (cookie + Bearer) authenticate.
//
// Beneath it: the per-repo collaborators leaf and the per-PR subtree, each
// behind its per-repo gate.
import { ProductQueryIds } from "../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session";
import type { AllowedRepoResolver } from "../allowed-repos";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import type { InstallationGitHubPort } from "../github-port";
import { collaboratorsRoute } from "./collaborators";
import createReposHandlers from "./handler";
import { prRoutes } from "./pr";

/** The slice of app deps the repos subtree needs. `AppDeps` satisfies it. */
export interface ReposRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
}

/** Mount the repos subtree: the list over the session gate (no `:repoId` —
 * the whole point is discovering them, sharing the injected allowed-set
 * resolver) plus the per-repo leaves. */
export function reposRoutes(
  deps: ReposRouteDeps,
  allowedRepos: AllowedRepoResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createReposHandlers(allowedRepos);

  app.use("/", sessionLayer(deps), accessStampLayer());

  app.query(
    {
      id: ProductQueryIds.LIST_REPOS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    handlers.listRepos,
  );

  app.route("/:repoId/collaborators", collaboratorsRoute(deps));
  app.route("/:repoId/pulls/:prNumber", prRoutes(deps));

  return app;
}
