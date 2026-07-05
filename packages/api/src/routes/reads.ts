// The reviewer read API (BRIEF-2 stage 7, PR C — plan decision #4). Four GETs,
// ALL behind the authz gate (`createAuthzMiddleware`), that return the
// tenant-scoped artifacts a reviewer's client renders:
//   brief / marks / narrative  → the stored artifact `body` verbatim (already
//                                 JSON — returned as-is, never re-parsed);
//   diff                        → a LIVE proxy of GitHub's unified diff, fetched
//                                 with the VIEWER's token and cached per session.
//
// TENANCY: the gate resolves `ctx` from the session; every read filters through
// persistence's ctx-bound seams (`forTenant` / `artifactStore`). This module
// never sees a raw handle and never trusts a caller-supplied installation id.
//
// DIFF PROXY (ADR 0016 #10): the diff is NEVER persisted — it is proxied live
// and held only in an ephemeral, per-session in-memory cache (~60s TTL) keyed by
// `(sessionHash, repoId, prNumber, base, head)`, so a repeat diff read makes no
// second GitHub call. The cache is a closure Map created once per app instance.
//
// VALIDATION: params/queries are Zod-validated → 400 on a bad shape; a missing
// PR / artifact is a 404; GitHub fetch failures are sanitized to 404/502. No
// upstream error text, token, or header ever reaches a response body.
import { Hono, type Context } from "hono";
import { createUserOctokit, fetchCompareDiff, GitHubApiErrorCode } from "github";
import {
  artifactStore,
  decryptToken,
  forTenant,
  type PullRequestRow,
  type RepoId,
  type TenantContext,
} from "persistence";
import { z } from "zod";
import { createAuthzMiddleware, type AuthzEnv } from "./authz";
import { refreshSessionToken, type AuthRouteDeps } from "./auth";
import { createTtlCache } from "./ttl-cache";

// ---------------------------------------------------------------------------
// Boundary schemas. A PR number is a positive int; a SHA is a non-empty token.
// ---------------------------------------------------------------------------

const prNumberSchema = z.coerce.number().int().positive();
const shaSchema = z.string().min(1);

const briefQuerySchema = z.object({ base: shaSchema, head: shaSchema });
const marksQuerySchema = z.object({ baseline: shaSchema, head: shaSchema });
const narrativeQuerySchema = z.object({ prevHead: shaSchema, head: shaSchema });
/**
 * Diff span endpoints. Beyond a non-empty SHA, these must NOT contain a `:` —
 * GitHub's compare endpoint reads `owner:ref` as a CROSS-REPO selector, which
 * would let a caller redirect the diff proxy at a fork outside the `repoId` the
 * authz gate approved. Rejecting `:` confines the compare to the resolved PR's
 * own repo (defense-in-depth; the fetch already runs under the viewer's token).
 */
const diffRefSchema = shaSchema.refine((value) => !value.includes(":"), {
  message: "diff ref must not select a cross-repo owner:ref span",
});
const diffQuerySchema = z.object({ base: diffRefSchema, head: diffRefSchema });

/** Per-session diff cache TTL — short; the diff is live, this only debounces. */
const DIFF_CACHE_TTL_MS = 60 * 1000;
/**
 * Hard cap on cached diffs (keyed session×repo×PR×span). Bounds memory: keys are
 * never reused (fresh session hash + new SHA pair per push), so an uncapped Map
 * would grow for the process lifetime. Diffs are larger than authz entries, so a
 * tighter cap; oldest is evicted past it (ADR 0016 #10 — never persisted).
 */
const DIFF_CACHE_MAX_ENTRIES = 2_000;
/**
 * Per-entry byte cap. The entry-count cap alone doesn't bound bytes — a run of
 * large-PR diffs could still balloon the map — so an oversized diff (rare, and
 * cheap to re-proxy) is served but NOT cached. This bounds worst-case cache
 * memory to `MAX_ENTRIES × MAX_ENTRY_BYTES` without byte-accounting in the cache.
 */
const DIFF_CACHE_MAX_ENTRY_BYTES = 1_000_000;

/**
 * Split a GitHub-verified `owner/repo` full name into its parts. Defensive
 * validation only — the value comes from the authz gate's access check, but a
 * malformed shape must still never reach a GitHub call.
 */
function splitRepoSlug(slug: string): { owner: string; repo: string } | undefined {
  const parts = slug.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || owner === undefined || repo === undefined || owner === "" || repo === "") {
    return undefined;
  }
  return { owner, repo };
}

/**
 * Mount the read API. The authz middleware AND the diff cache are created here —
 * once per `createApp` — so both are scoped to the app instance.
 */
export function readsRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);
  // key `${sessionHash}:${repoId}:${prNumber}:${base}:${head}` → cached diff,
  // bounded (never-reused keys can't be allowed to grow unbounded).
  const diffCache = createTtlCache<string>(DIFF_CACHE_MAX_ENTRIES);

  // The gate guards every read under this prefix.
  app.use("/api/repos/:repoId/*", authz);

  /**
   * Resolve `:prNumber` and the tenant PR row, or return the mapped error
   * status. `undefined` return means "response already sent".
   */
  async function resolvePr(
    ctx: TenantContext,
    repoId: RepoId,
    rawPrNumber: string | undefined,
  ): Promise<
    | { ok: true; pr: PullRequestRow }
    | { ok: false; status: 400 | 404 }
  > {
    const parsed = prNumberSchema.safeParse(rawPrNumber);
    if (!parsed.success) {
      return { ok: false, status: 400 };
    }
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(repoId, parsed.data);
    if (pr === undefined) {
      return { ok: false, status: 404 };
    }
    return { ok: true, pr };
  }

  // GET brief — the whole-PR span artifact for (base, head).
  app.get("/api/repos/:repoId/pulls/:prNumber/brief", async (c) => {
    const query = briefQuerySchema.safeParse({
      base: c.req.query("base"),
      head: c.req.query("head"),
    });
    if (!query.success) {
      return c.json({ error: "invalid query parameters" }, 400);
    }
    const resolved = await resolvePr(c.get("ctx"), c.get("repoId"), c.req.param("prNumber"));
    if (!resolved.ok) {
      return c.json({ error: resolved.status === 400 ? "invalid request" : "not found" }, resolved.status);
    }
    const row = await artifactStore(deps.handle, c.get("ctx")).briefs.get(
      resolved.pr.id,
      query.data.base,
      query.data.head,
    );
    if (row === undefined) {
      return c.json({ error: "not found" }, 404);
    }
    return artifactJson(c, row.body);
  });

  // GET marks — comparison marks (coordinates only) for (baseline, head).
  app.get("/api/repos/:repoId/pulls/:prNumber/marks", async (c) => {
    const query = marksQuerySchema.safeParse({
      baseline: c.req.query("baseline"),
      head: c.req.query("head"),
    });
    if (!query.success) {
      return c.json({ error: "invalid query parameters" }, 400);
    }
    const resolved = await resolvePr(c.get("ctx"), c.get("repoId"), c.req.param("prNumber"));
    if (!resolved.ok) {
      return c.json({ error: resolved.status === 400 ? "invalid request" : "not found" }, resolved.status);
    }
    const row = await artifactStore(deps.handle, c.get("ctx")).comparisonMarks.get(
      resolved.pr.id,
      query.data.baseline,
      query.data.head,
    );
    if (row === undefined) {
      return c.json({ error: "not found" }, 404);
    }
    return artifactJson(c, row.body);
  });

  // GET narrative — the revision narrative for (prevHead, head).
  app.get("/api/repos/:repoId/pulls/:prNumber/narrative", async (c) => {
    const query = narrativeQuerySchema.safeParse({
      prevHead: c.req.query("prevHead"),
      head: c.req.query("head"),
    });
    if (!query.success) {
      return c.json({ error: "invalid query parameters" }, 400);
    }
    const resolved = await resolvePr(c.get("ctx"), c.get("repoId"), c.req.param("prNumber"));
    if (!resolved.ok) {
      return c.json({ error: resolved.status === 400 ? "invalid request" : "not found" }, resolved.status);
    }
    const row = await artifactStore(deps.handle, c.get("ctx")).revisionNarratives.get(
      resolved.pr.id,
      query.data.prevHead,
      query.data.head,
    );
    if (row === undefined) {
      return c.json({ error: "not found" }, 404);
    }
    return artifactJson(c, row.body);
  });

  // GET diff — LIVE proxy of the requested `base...head` span diff (GitHub's
  // compare endpoint) with the viewer's token, cached per session (~60s).
  // Never persisted (ADR 0016 #10).
  app.get("/api/repos/:repoId/pulls/:prNumber/diff", async (c) => {
    const query = diffQuerySchema.safeParse({
      base: c.req.query("base"),
      head: c.req.query("head"),
    });
    if (!query.success) {
      return c.json({ error: "invalid query parameters" }, 400);
    }
    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const resolved = await resolvePr(ctx, repoId, c.req.param("prNumber"));
    if (!resolved.ok) {
      return c.json({ error: resolved.status === 400 ? "invalid request" : "not found" }, resolved.status);
    }
    // Fetch by the AUTHZ-VERIFIED full name from this request's access check,
    // never the row's stored repo_slug — a rename + name-reuse could point the
    // stored slug at a different repo than the numeric id the gate authorized.
    const target = splitRepoSlug(c.get("repoFullName"));
    if (target === undefined) {
      return c.json({ error: "not found" }, 404);
    }

    const session = c.get("session");
    const cacheKey = `${session.sessionTokenHash}:${String(repoId)}:${resolved.pr.prNumber}:${query.data.base}:${query.data.head}`;
    const now = Date.now();
    const cached = diffCache.get(cacheKey, now);
    if (cached !== undefined) {
      return c.body(cached, 200, diffHeaders());
    }

    // The token is set by the gate on the GitHub-verified path; on a
    // positive-cache hit it is absent, so decrypt the session's token lazily.
    let currentSession = session;
    let accessToken = c.get("accessToken") ?? (await resolveSessionToken(deps, currentSession));
    if (accessToken === undefined) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // Fetch the diff for the REQUESTED span (base...head), not the whole PR.
    const span = { owner: target.owner, repo: target.repo, base: query.data.base, head: query.data.head };
    let diff = await fetchCompareDiff(createUserOctokit(accessToken), span);

    // A positive-cache hit skips the gate's GitHub check, so the lazily-decrypted
    // token may be an expired ~8h access token → GitHub 401. Refresh once and
    // retry (mirrors the gate's verified path) before surfacing a failure.
    if (!diff.ok && diff.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
      const refreshed = await refreshSessionToken(deps, currentSession);
      if (!refreshed.ok) {
        return c.json({ error: "unauthorized" }, 401);
      }
      currentSession = refreshed.value.session;
      accessToken = refreshed.value.accessToken;
      diff = await fetchCompareDiff(createUserOctokit(accessToken), span);
    }
    if (!diff.ok) {
      // 406 = GitHub refuses to render the diff (too large: >300 files/20k
      // lines) — a PERMANENT condition for this span, so surface it as 413
      // rather than a retryable-looking 502.
      if (diff.error.status === 406) {
        return c.json({ error: "diff too large to render" }, 413);
      }
      const status = diff.error.code === GitHubApiErrorCode.NOT_FOUND ? 404 : 502;
      return c.json({ error: status === 404 ? "not found" : "upstream error" }, status);
    }
    // Serve always; cache only when small enough (oversized diffs are rare and
    // cheap to re-proxy) so the map can't grow past its byte budget.
    if (diff.value.length <= DIFF_CACHE_MAX_ENTRY_BYTES) {
      diffCache.set(cacheKey, diff.value, now + DIFF_CACHE_TTL_MS, now);
    }
    return c.body(diff.value, 200, diffHeaders());
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Return a stored artifact `body` verbatim as JSON. The body is ALREADY a JSON
 * string (persistence passthrough) — do NOT re-parse/re-serialize it.
 * `no-store`: these are per-viewer, authz-gated responses.
 */
function artifactJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

function diffHeaders(): Record<string, string> {
  return { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
}

/** Decrypt a session's stored access token; `undefined` if it is unreadable. */
async function resolveSessionToken(
  deps: AuthRouteDeps,
  session: { keyRef: string; ghTokenCiphertext: string },
): Promise<string | undefined> {
  const decrypted = await decryptToken(
    deps.auth.keyProvider,
    session.keyRef,
    session.ghTokenCiphertext,
  );
  return decrypted.ok ? decrypted.value : undefined;
}
