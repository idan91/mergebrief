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
import { Hono } from "hono";
import { ApiErrorCode, errorJson } from "../../error-response";
import type { AuthRouteDeps } from "../auth/session";
import type { AllowedRepoResolver } from "../allowed-repos";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import type { InstallationGitHubPort } from "../github-port";
import { collaboratorsRoute } from "./collaborators";
import { prRoutes } from "./pr";

const NO_STORE = { "cache-control": "no-store" } as const;

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
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();

  app.use("/", sessionLayer(deps), accessStampLayer());

  app.get("/", async (c) => {
    const resolved = await allowedRepos.resolve(
      c.get("session"),
      c.get("logger"),
    );
    if (!resolved.ok) {
      return errorJson(
        c,
        resolved.error.status === 401
          ? ApiErrorCode.UNAUTHORIZED
          : ApiErrorCode.GITHUB_UNAVAILABLE,
      );
    }
    // Deterministic order for humans and diffs: fullName ascending.
    const repos = [...resolved.value.allowed.entries()]
      .map(([repoId, fullName]) => ({ repoId: String(repoId), fullName }))
      .toSorted((a, b) => a.fullName.localeCompare(b.fullName));
    return c.json({ repos }, 200, NO_STORE);
  });

  app.route("/:repoId/collaborators", collaboratorsRoute(deps));
  app.route("/:repoId/pulls/:prNumber", prRoutes(deps));

  return app;
}
