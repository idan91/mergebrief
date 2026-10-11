// The `/repos` subtree, owner/name to repoId resolution for the CLI. The
// repositories come from the SHARED installation resolver, every reachable
// installation's intersection with the viewer's access, one cache with
// /pulls. `repoId` is stringified because bigint is not JSON-native, the
// array is deliberately unpaginated, the response is `no-store`, and a
// GitHub failure is a 401 or 502 rather than a DB-only fallback. Beneath it
// sit the per-repo attachments purge and collaborators leaves and the per-PR
// subtree, all behind the ONE repo gate mounted over `/:repoId/*`.
import { ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../auth/session/types";
import type { InstallationResolver } from "../installation-resolver";
import { createAuthzMiddleware } from "../../access";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import type { InstallationGitHubPort } from "../github-port";
import { purgeAttachmentsRoute } from "./attachments";
import { collaboratorsRoute } from "./collaborators";
import { createReposHandlers } from "./handler";
import { prRoutes } from "./pr";
import type { UploadQuotaLimits } from "./pr/attachments/types";

/** The slice of app deps the repos subtree needs. `AppDeps` satisfies it. */
export interface ReposRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
  readonly attachmentQuota?: UploadQuotaLimits;
}

/** Mount the repos subtree: the list over the session gate (no `:repoId`,
 * the whole point is discovering them, sharing the injected allowed-set
 * resolver) plus the per-repo leaves. */
export function reposRoutes(
  deps: ReposRouteDeps,
  installations: InstallationResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createReposHandlers(installations);

  app.use("/", sessionLayer(deps), accessStampLayer());

  app.query(
    {
      id: ProductQueryIds.LIST_REPOS,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listRepos,
  );

  // Method-agnostic and over unmatched paths too: every request under a repo
  // traverses exactly one gate, so one positive cache serves every leaf.
  app.use("/:repoId/*", createAuthzMiddleware(deps, installations));
  app.route("/:repoId/attachments", purgeAttachmentsRoute(deps));
  app.route("/:repoId/collaborators", collaboratorsRoute(deps));
  app.route("/:repoId/pulls/:prNumber", prRoutes(deps));

  return app;
}
