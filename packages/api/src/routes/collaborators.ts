// The collaborators surface: one gated live-fetch GET —
// GET /api/repos/:repoId/collaborators — the @mention autocomplete pool.
//
// Fetched from GitHub over the package's GraphQL primitive with the
// INSTALLATION token (the gate already proved the viewer's repo access; a
// shared token means one rate budget and ONE cache entry per repo). 60s
// positive TTL, response `no-store`, nothing persisted.
//
// GUARD — `viewerCanPush`: GitHub itself denies the roster to viewers without
// push access; serving it on the installation token would otherwise leak
// logins + names to any read-access viewer (on a public repo, anyone).
// Non-push viewers get the gate's 404 posture BEFORE any GitHub call.
import { Hono, type Context } from "hono";
import { GitHubApiErrorCode } from "github";
import type { InstallationId, RepoId } from "persistence";
import type { AuthRouteDeps } from "./auth";
import { createAuthzMiddleware, type AuthzEnv } from "./authz";
import type { InstallationGitHubPort } from "./github-port";
import { createTtlCache } from "./ttl-cache";

/** Positive TTL — same 60s staleness family as the other gated reads. */
const COLLABORATORS_CACHE_TTL_MS = 60 * 1000;
/** One entry per installation×repo — far fewer keys than the per-PR caches. */
const COLLABORATORS_CACHE_MAX_ENTRIES = 2_000;

function cacheKey(installationId: InstallationId, repoId: RepoId): string {
  return `${String(installationId)}:${String(repoId)}`;
}

/** Sanitized error response with the gated-route `no-store` posture. */
function errorJson(
  c: Context<AuthzEnv>,
  message: string,
  status: 404 | 502,
): Response {
  return c.json({ error: message }, status, { "cache-control": "no-store" });
}

/** Split the gate's verified `owner/name`; `undefined` on a non-slug shape. */
function splitRepoSlug(
  fullName: string,
): { owner: string; repo: string } | undefined {
  const parts = fullName.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    owner === "" ||
    repo === undefined ||
    repo === ""
  ) {
    return undefined;
  }
  return { owner, repo };
}

export interface CollaboratorsRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
}

/** Mount the collaborators read behind its own per-repo gate instance. */
export function collaboratorsRoute(
  deps: CollaboratorsRouteDeps,
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);
  // Serialized response bodies, keyed installation:repo (shared across every
  // viewer — the point of the installation-token read).
  const cache = createTtlCache<string>(COLLABORATORS_CACHE_MAX_ENTRIES);

  app.use("/api/repos/:repoId/collaborators", authz);

  app.get("/api/repos/:repoId/collaborators", async (c) => {
    // Push-gate BEFORE the cache: the cached roster is repo-shared, and a
    // read-only viewer must not be able to read it out of the cache either.
    if (!c.get("viewerCanPush")) {
      return errorJson(c, "not found", 404);
    }

    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const key = cacheKey(ctx.installationId, repoId);
    const now = Date.now();
    const cached = cache.get(key, now);
    if (cached !== undefined) {
      return rosterJson(c, cached);
    }

    // Fetch by the AUTHZ-VERIFIED full name (read posture — ≤60s staleness is
    // the same budget as the gate's own positive cache).
    const target = splitRepoSlug(c.get("repoFullName"));
    if (target === undefined) {
      return errorJson(c, "not found", 404);
    }
    const fetched = await deps.github.listRepoCollaborators(
      ctx.installationId,
      {
        owner: target.owner,
        repo: target.repo,
      },
    );
    if (!fetched.ok) {
      // 404-collapse posture identical to the other reads; everything else is
      // an honest upstream error.
      if (fetched.error.code === GitHubApiErrorCode.NOT_FOUND) {
        return errorJson(c, "not found", 404);
      }
      return errorJson(c, "upstream error", 502);
    }
    const body = JSON.stringify(fetched.value);
    cache.set(key, body, now + COLLABORATORS_CACHE_TTL_MS, now);
    return rosterJson(c, body);
  });

  return app;
}

/** A cached/serialized roster body, per-viewer gated — `no-store`. */
function rosterJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}
