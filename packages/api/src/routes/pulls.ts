// The session-scoped PR list (BRIEF-19 PR 1.2): `GET /api/pulls` returns the
// viewer's readable PRs across the session's installation — the ONE read that
// cannot reuse the per-repo gate (there is no `:repoId` yet).
//
// TENANCY (ADR 0016 #5b as amended): the authorized repo set comes from the
// SHARED allowed-set resolver (`allowed-repos.ts`, one cache with
// `/api/repos` — BRIEF-17 PR 3). The tenant query then filters
// `installation_id = ctx AND repo_id IN (allowed)`. A GitHub failure fails
// the list (401/502) — NEVER a DB-only listing, which would leak rows the
// viewer can no longer see.
import { Hono } from "hono";
import { artifactStore, forTenant, generationProjection } from "persistence";
import { z } from "zod";
import type { AuthRouteDeps } from "./auth";
import type { AllowedRepoResolver } from "./allowed-repos";
import { accessLogLayer, sessionLayer, type AuthzEnv } from "./authz";
import { buildPrView } from "./pr-view";

// Per-viewer state on a gated route — no-store on EVERY response, error
// paths included (AGENTS.md rule; codex PR3 R1).
const NO_STORE = { "cache-control": "no-store" } as const;

/** Hard row cap (plan: flat list, no cursor); also the Zod upper bound. */
const LIST_MAX_ROWS = 100;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIST_MAX_ROWS).default(LIST_MAX_ROWS),
});

/** Mount the list endpoint over the shared allowed-set resolver. */
export function pullsRoute(
  deps: AuthRouteDeps,
  allowedRepos: AllowedRepoResolver,
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();

  app.use("/api/pulls", sessionLayer(deps), accessLogLayer());

  app.get("/api/pulls", async (c) => {
    const query = listQuerySchema.safeParse({ limit: c.req.query("limit") ?? undefined });
    if (!query.success) {
      return c.json({ error: "invalid query parameters" }, 400, NO_STORE);
    }
    const ctx = c.get("ctx");

    const resolved = await allowedRepos.resolve(c.get("session"));
    if (!resolved.ok) {
      return c.json(
        { error: resolved.error.status === 401 ? "unauthorized" : "upstream error" },
        resolved.error.status,
        NO_STORE,
      );
    }
    const allowed = resolved.value.allowed;

    const tenant = forTenant(deps.handle, ctx);
    const rows = await tenant.pullRequests.listForRepos([...allowed.keys()], query.data.limit);
    const ids = rows.map((row) => row.id);
    const [latestBriefs, latestGenerations] = await Promise.all([
      artifactStore(deps.handle, ctx).briefs.latestForPullRequests(ids),
      generationProjection(deps.handle, ctx).latestBriefForPullRequests(ids),
    ]);

    const pulls = rows.map((row) =>
      buildPrView(row, latestBriefs.get(row.id), latestGenerations.get(row.id), allowed.get(row.repoId)),
    );
    return c.json({ pulls }, 200, NO_STORE);
  });

  return app;
}
