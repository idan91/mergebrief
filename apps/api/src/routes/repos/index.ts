// The `/repos` subtree, owner/name to repoId resolution for the CLI. The
// repositories come from the SHARED installation resolver, every reachable
// installation's intersection with the viewer's access, one cache with
// /pulls. `repoId` is stringified because bigint is not JSON-native, the
// array is deliberately unpaginated, the response is `no-store`, and a
// GitHub failure is a 401 or 502 rather than a DB-only fallback. Beneath it
// sit the per-repo attachments purge and collaborators leaves and the per-PR
// subtree, all behind the ONE repo gate mounted over `/:repoId/*`.
import {
  ApiErrorCodes,
  ProductQueryIds,
  type ListReposResponse,
} from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import { createAuthzMiddleware } from "../../access";
import { bindRequestGitHub } from "../../access/reviewer-binding";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv, InstallationBindingDeps } from "../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { BadGateway, Unauthorized } from "../../shared-errors/api-error";
import type { AuthRouteDeps } from "../auth/session/types";
import type { InstallationResolver } from "../installation-resolver";
import { purgeAttachmentsRoute } from "./attachments";
import { collaboratorsRoute } from "./collaborators";
import { listRepos } from "./list-repos";
import { prRoutes } from "./pr";
import type { UploadQuotaLimits } from "./pr/attachments/types";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The slice of app deps the repos subtree needs. `AppDeps` satisfies it. */
export interface ReposRouteDeps extends AuthRouteDeps, InstallationBindingDeps {
  readonly attachmentQuota?: UploadQuotaLimits;
}

function createListReposHandler(
  deps: AuthRouteDeps,
  installations: InstallationResolver,
): Handler<AuthzEnv> {
  return async (c) => {
    const log = c.get("logger");
    const request = bindRequestGitHub(deps, c.get("session"), log);
    const listed = await listRepos(installations, request, log);
    if (!listed.ok) {
      if (listed.error.status === HttpStatuses.UNAUTHORIZED) {
        throw new Unauthorized();
      }
      throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
    }

    const body: ListReposResponse = listed.value;
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };
}

/** Mount the repos subtree: the list over the session gate (no `:repoId`,
 * the whole point is discovering them, sharing the injected allowed-set
 * resolver) plus the per-repo leaves. */
export function reposRoutes(
  deps: ReposRouteDeps,
  installations: InstallationResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();

  app.use("/", sessionLayer(deps), accessStampLayer());

  app.query(
    {
      id: ProductQueryIds.LIST_REPOS,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    createListReposHandler(deps, installations),
  );

  // Method-agnostic and over unmatched paths too: every request under a repo
  // traverses exactly one gate, so one positive cache serves every leaf.
  app.use("/:repoId/*", createAuthzMiddleware(deps, installations));
  app.route("/:repoId/attachments", purgeAttachmentsRoute(deps));
  app.route("/:repoId/collaborators", collaboratorsRoute(deps));
  app.route("/:repoId/pulls/:prNumber", prRoutes(deps));

  return app;
}
