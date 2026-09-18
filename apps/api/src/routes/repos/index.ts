// The `/repos` subtree, owner/name to repoId resolution for the CLI. The
// installation and user-access intersection comes from the SHARED allowed-set
// resolver, one cache with /pulls. `repoId` is stringified because bigint is
// not JSON-native, the array is deliberately unpaginated, the response is
// `no-store`, and a GitHub failure is a 401 or 502 rather than a DB-only
// fallback. Beneath it sit the per-repo collaborators leaf and the per-PR
// subtree, each behind its per-repo gate.
import { ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session/types";
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

/** Mount the repos subtree: the list over the session gate (no `:repoId`,
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
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listRepos,
  );

  app.route("/:repoId/collaborators", collaboratorsRoute(deps, allowedRepos));
  app.route("/:repoId/pulls/:prNumber", prRoutes(deps, allowedRepos));

  return app;
}
