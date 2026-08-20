// The session-scoped PR list: `GET /api/pulls` returns the viewer's readable
// PRs across the session's installation — the ONE read that cannot reuse the
// per-repo gate (there is no `:repoId` yet).
//
// TENANCY: the authorized repo set comes from the SHARED allowed-set resolver
// (`allowed-repos.ts`, one cache with `/api/repos`). The tenant query then
// filters `installation_id = ctx AND repo_id IN (allowed)`. A GitHub failure
// fails the list (401/502) — NEVER a DB-only listing, which would leak rows the
// viewer can no longer see.
import { artifactStore, forTenant, generationProjection } from "persistence";
import { z } from "zod";
import { ApiErrorCode, errorJson } from "../error-response";
import { PRODUCT_QUERY_ID } from "../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../product-operations/types";
import type { AuthRouteDeps } from "./auth/session";
import type { AllowedRepoResolver } from "./allowed-repos";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "./authz";
import { buildPrView } from "./pr-view";

// Per-viewer state on a gated route — no-store on EVERY response, error
// paths included.
const NO_STORE = { "cache-control": "no-store" } as const;

/** Hard row cap (flat list, no cursor); also the Zod upper bound. */
const LIST_MAX_ROWS = 100;

const listQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIST_MAX_ROWS)
    .default(LIST_MAX_ROWS),
});

/** Mount the list endpoint over the shared allowed-set resolver. */
export function pullsRoute(
  deps: AuthRouteDeps,
  allowedRepos: AllowedRepoResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();

  app.use("/", sessionLayer(deps), accessStampLayer());

  app.query(
    {
      id: PRODUCT_QUERY_ID.LIST_PULLS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    async (c) => {
      const query = listQuerySchema.safeParse({
        limit: c.req.query("limit") ?? undefined,
      });
      if (!query.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const ctx = c.get("ctx");

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
      const allowed = resolved.value.allowed;

      const tenant = forTenant(deps.handle, ctx);
      const rows = await tenant.pullRequests.listForRepos(
        [...allowed.keys()],
        query.data.limit,
      );
      const ids = rows.map((row) => row.id);
      const [latestBriefs, latestGenerations] = await Promise.all([
        artifactStore(deps.handle, ctx).briefs.latestForPullRequests(ids),
        generationProjection(deps.handle, ctx).latestBriefForPullRequests(ids),
      ]);

      const viewerLogin = c.get("session").reviewerLogin;
      const pulls = rows.map((row) =>
        // List path: the allowed-set intersection proves access but carries no
        // permissions block, so push capability is UNKNOWN here — fail closed
        // (authorship-only viewerCanResolve; the brief page reads PR meta).
        buildPrView(
          row,
          latestBriefs.get(row.id),
          latestGenerations.get(row.id),
          allowed.get(row.repoId),
          viewerLogin,
          false,
        ),
      );
      return c.json({ pulls }, 200, NO_STORE);
    },
  );

  return app;
}
