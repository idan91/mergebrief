// `GET /api/repos` (BRIEF-17 PR 3 — ADR 0028 consequence): the CLI's
// owner/name → repoId resolution. The locked contract (plan decision 3):
// the installation∩user-access intersection via the SHARED allowed-set
// resolver (one cache with /api/pulls); `repoId` stringified (bigint is not
// JSON-native); a FLAT array, deliberately unpaginated (an installation's
// repo grant is a bounded set); `no-store` (per-viewer state); a GitHub
// failure is a 401/502 — never a DB-only fallback. Lives under `/api/*`, so
// both presentation channels (cookie + Bearer) authenticate.
import { Hono } from "hono";
import type { AuthRouteDeps } from "./auth";
import type { AllowedRepoResolver } from "./allowed-repos";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "./authz";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Mount `GET /api/repos` over the session gate (no `:repoId` — the whole
 * point is discovering them), sharing the injected allowed-set resolver. */
export function reposRoute(
  deps: AuthRouteDeps,
  allowedRepos: AllowedRepoResolver,
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();

  app.use("/api/repos", sessionLayer(deps), accessStampLayer());

  app.get("/api/repos", async (c) => {
    const resolved = await allowedRepos.resolve(
      c.get("session"),
      c.get("logger"),
    );
    if (!resolved.ok) {
      return c.json(
        {
          error:
            resolved.error.status === 401 ? "unauthorized" : "upstream error",
        },
        resolved.error.status,
        NO_STORE,
      );
    }
    // Deterministic order for humans and diffs: fullName ascending.
    const repos = [...resolved.value.allowed.entries()]
      .map(([repoId, fullName]) => ({ repoId: String(repoId), fullName }))
      .toSorted((a, b) => a.fullName.localeCompare(b.fullName));
    return c.json({ repos }, 200, NO_STORE);
  });

  return app;
}
