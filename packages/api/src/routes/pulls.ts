// The session-scoped PR list (BRIEF-19 PR 1.2): `GET /api/pulls` returns the
// viewer's readable PRs across the session's installation — the ONE read that
// cannot reuse the per-repo gate (there is no `:repoId` yet).
//
// TENANCY (ADR 0016 #5b as amended): the authorized repo set is the
// installation∩user-access intersection from GitHub
// (`GET /user/installations/{id}/repositories`, VIEWER token), cached per
// session for the same 60s constant as the positive authz cache. The tenant
// query then filters `installation_id = ctx AND repo_id IN (allowed)`. A
// GitHub failure fails the list (401/502) — NEVER a DB-only listing, which
// would leak rows the viewer can no longer see.
import { Hono } from "hono";
import {
  createUserOctokit,
  GitHubApiErrorCode,
  listInstallationRepositoriesForUser,
} from "github";
import {
  artifactStore,
  decryptToken,
  forTenant,
  generationProjection,
  sessionAuth,
  type RepoId,
} from "persistence";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "./auth";
import { accessLogLayer, AUTHZ_CACHE_TTL_MS, sessionLayer, type AuthzEnv } from "./authz";
import { buildPrView } from "./pr-view";
import { createTtlCache } from "./ttl-cache";

/** Hard row cap (plan: flat list, no cursor); also the Zod upper bound. */
const LIST_MAX_ROWS = 100;
/**
 * Cap on cached allowed-repo sets (one per live session). Session hashes are
 * never reused, so an unbounded map would grow for the process lifetime.
 */
const ALLOWED_SET_CACHE_MAX_ENTRIES = 5_000;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIST_MAX_ROWS).default(LIST_MAX_ROWS),
});

/** Mount the list endpoint. The allowed-set cache is app-instance-scoped. */
export function pullsRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  // key sessionTokenHash → repoId → GitHub-verified `owner/name`. POSITIVE
  // results only (a failed fetch is never cached), 60s (same constant as the
  // per-repo positive cache — one revocation-staleness budget).
  const allowedRepoCache = createTtlCache<ReadonlyMap<RepoId, string>>(
    ALLOWED_SET_CACHE_MAX_ENTRIES,
  );

  app.use("/api/pulls", sessionLayer(deps), accessLogLayer());

  app.get("/api/pulls", async (c) => {
    const query = listQuerySchema.safeParse({ limit: c.req.query("limit") ?? undefined });
    if (!query.success) {
      return c.json({ error: "invalid query parameters" }, 400);
    }
    const session = c.get("session");
    const ctx = c.get("ctx");

    // Resolve the viewer's allowed-repo set (cache → GitHub w/ refresh-once).
    let allowed = allowedRepoCache.get(session.sessionTokenHash);
    if (allowed === undefined) {
      const decrypted = await decryptToken(
        deps.auth.keyProvider,
        session.keyRef,
        session.ghTokenCiphertext,
      );
      if (!decrypted.ok) {
        // Unreadable token burns the session — same posture as the repo gate.
        await sessionAuth(deps.handle).deleteSession(session.sessionTokenHash);
        return c.json({ error: "unauthorized" }, 401);
      }
      let currentSession = session;
      let accessToken = decrypted.value;
      let repos = await listInstallationRepositoriesForUser(
        createUserOctokit(accessToken),
        currentSession.installationId,
      );
      if (!repos.ok && repos.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
        // Expired ~8h access token → serialized refresh, retry ONCE.
        const refreshed = await refreshSessionToken(deps, currentSession);
        if (!refreshed.ok) {
          return c.json({ error: "unauthorized" }, 401);
        }
        currentSession = refreshed.value.session;
        accessToken = refreshed.value.accessToken;
        repos = await listInstallationRepositoriesForUser(
          createUserOctokit(accessToken),
          currentSession.installationId,
        );
      }
      if (!repos.ok) {
        // Fail the list — a DB-only fallback would leak rows (ADR 0016 #5b).
        const status = repos.error.code === GitHubApiErrorCode.UNAUTHORIZED ? 401 : 502;
        return c.json({ error: status === 401 ? "unauthorized" : "upstream error" }, status);
      }
      allowed = repos.value;
      allowedRepoCache.set(session.sessionTokenHash, allowed, Date.now() + AUTHZ_CACHE_TTL_MS);
    }

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
    return c.json({ pulls }, 200, { "cache-control": "no-store" });
  });

  return app;
}
