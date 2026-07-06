// The reviewer authorization gate (BRIEF-2 stage 7, PR C — ADR 0016 #5's
// SINGLE enforcement point, as amended for BRIEF-19). The gate is built from
// two composable layers with ONE enforcement point and two compositions:
//   `sessionLayer`   — opaque cookie → session row → expiry → tenant ctx (no
//                      cookie / unknown / expired session → 401 — never a hint
//                      that the repo exists). Reused ALONE by session-scoped
//                      endpoints (the PR list) that carry no `:repoId`.
//   `repoAuthzLayer` — parse+brand `:repoId`, verify the viewer's GitHub access
//                      to the repo by its NUMERIC id (`GET /repositories/{id}`
//                      with the viewer's own token — rename-proof); any non-2xx
//                      collapses to 404 (no existence leak) and emits the D9
//                      `auth` denial audit row; on success shapes the request
//                      context (`repoId`, `repoFullName`, `accessToken`).
// `createAuthzMiddleware` = the composition of both — the per-repo gate in
// front of every read under `/api/repos/:repoId/*`.
//
// CACHING (ADR 0016 #4 as amended): a POSITIVE cache keyed
// `(sessionHash, repoId)` with a 60s TTL skips the GitHub round-trip on repeat
// authorized reads. NEGATIVES ARE NEVER CACHED — a revoked grant must re-deny
// on the very next request; a granted-then-revoked viewer is stale for at most
// 60s. The cache is a closure created ONCE per `repoAuthzLayer` (not a module
// global), so tests get a fresh cache per `createApp`.
//
// REFRESH (D11): a 401 from GitHub means the viewer's ~8h access token expired;
// the layer runs the serialized `refreshSessionToken` orchestrator and retries
// the access check ONCE with the rotated token. A refresh failure has already
// deleted the session, so it is a clean 401 → re-login.
//
// LOGGING (D9): each request emits ONE structured stdout access line
// (method/path/status/latency + numeric repo/reviewer ids) — the purgeable web
// access log, NOT the never-purged audit ledger, and NEVER any token/cookie/PII.
// `sessionLayer` logs its own denials; the LAST layer in a composition logs the
// allowed path after the handler. A session-only composition must therefore
// emit its own success line (the list endpoint does).
import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { getCookie } from "hono/cookie";
import { createUserOctokit, fetchRepositoryById } from "github";
import {
  audit,
  AuditAction,
  AuditActorType,
  AuditMetadataKey,
  decryptToken,
  isRepoId,
  sessionAuth,
  type RepoId,
  type ReviewerSessionRow,
  type TenantContext,
} from "persistence";
import {
  refreshSessionToken,
  SESSION_COOKIE,
  sha256Hex,
  type AuthRouteDeps,
} from "./auth";
import { createTtlCache } from "./ttl-cache";

// ---------------------------------------------------------------------------
// Typed Hono context vars. Handlers read these safely (no `any`): `ctx`/
// `session` are set once `sessionLayer` passes; `repoId`/`repoFullName` once
// `repoAuthzLayer` passes; `accessToken` only on the GitHub-verified path (a
// positive-cache hit skips the decrypt, so the diff route decrypts lazily from
// `session` when it is absent).
// ---------------------------------------------------------------------------

export interface AuthzVariables {
  readonly ctx: TenantContext;
  readonly session: ReviewerSessionRow;
  readonly repoId: RepoId;
  /**
   * The repo's `owner/name` as GITHUB verified it during the access check
   * (cached with the positive entry, so ≤60s stale). Routes that call GitHub
   * by name (the diff proxy) MUST use this, never the row's stored `repo_slug`:
   * a rename + name-reuse could otherwise point the stored slug at a DIFFERENT
   * repo than the numeric id the gate authorized.
   */
  readonly repoFullName: string;
  readonly accessToken?: string;
  /**
   * Request start as recorded at gate entry by `sessionLayer` — keeps the one
   * D9 access line's `durationMs` anchored to gate entry across the layer
   * split, whichever layer ends up emitting it.
   */
  readonly gateStartedAt: number;
}

export interface AuthzEnv {
  readonly Variables: AuthzVariables;
}

/**
 * Positive-cache TTL — short enough that a revoked grant self-heals fast
 * (ADR 0016 #4 as amended: 60s, tightened from the original 5min). PR 1.2's
 * per-session allowed-repo-set cache deliberately shares this constant.
 */
export const AUTHZ_CACHE_TTL_MS = 60 * 1000;
/**
 * Hard cap on live positive-cache entries (one per session×repo). Bounds memory
 * regardless of process uptime — session hashes are one-time-random, so keys are
 * never reused and would otherwise accumulate forever. Generous for M1 self-host
 * (a handful of reviewers × repos); the oldest entry is evicted past the cap.
 */
const POSITIVE_CACHE_MAX_ENTRIES = 50_000;

/** The access-check decision, as it appears in the stdout access log. */
type AccessDecision = "200" | "401" | "404";

function positiveCacheKey(sessionTokenHash: string, repoId: RepoId): string {
  return `${sessionTokenHash}:${String(repoId)}`;
}

/** Brand a `:repoId` path segment; `undefined` when it isn't a positive int. */
function parseRepoId(raw: string | undefined): RepoId | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  return isRepoId(value) ? value : undefined;
}

/**
 * One purgeable stdout access line — numeric ids only, never a token.
 * `decision` is the GATE's outcome; `status` is the RESPONSE status. On deny
 * paths they coincide; on the allowed path this is called AFTER `next()`, so
 * `status` reflects what the handler actually returned and `durationMs`
 * includes handler time (the D9 log contract).
 */
function logAccess(
  c: Context<AuthzEnv>,
  startedAt: number,
  decision: AccessDecision,
  fields: { repoId?: RepoId; reviewerId?: bigint },
): void {
  const line: Record<string, string | number> = {
    evt: "read",
    method: c.req.method,
    path: c.req.path,
    status: decision === "200" ? c.res.status : Number(decision),
    durationMs: Date.now() - startedAt,
    decision,
  };
  if (fields.repoId !== undefined) {
    line["repoId"] = String(fields.repoId);
  }
  if (fields.reviewerId !== undefined) {
    line["reviewerId"] = String(fields.reviewerId);
  }
  console.info(JSON.stringify(line));
}

/**
 * Layer 1 — resolve the reviewer session and tenant ctx from the opaque
 * cookie. Denies with 401 (and logs its own access line); on success sets
 * `ctx`/`session`/`gateStartedAt` and defers logging to the composition's
 * last layer.
 */
export function sessionLayer(deps: AuthRouteDeps): MiddlewareHandler<AuthzEnv> {
  return async (c, next) => {
    const startedAt = Date.now();

    // No cookie / unknown session both → 401 with no GitHub call and no
    // repo-existence hint.
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie === undefined) {
      logAccess(c, startedAt, "401", {});
      return c.json({ error: "unauthorized" }, 401);
    }
    const sessionTokenHash = sha256Hex(cookie);
    const session = await sessionAuth(deps.handle).findSession(sessionTokenHash);
    if (session === undefined) {
      logAccess(c, startedAt, "401", {});
      return c.json({ error: "unauthorized" }, 401);
    }
    // `findSession` is a plain resolver (it doesn't filter on expiry), so expiry
    // is enforced HERE, at the auth decision point. `expires_at` tracks the ~6mo
    // refresh-token lifetime: once it's past, the refresh token itself is dead,
    // so there is no recovery — burn the row and force a fresh login. (An expired
    // ~8h ACCESS token is different — it still flows through the 401→refresh path
    // in `repoAuthzLayer`.)
    if (session.expiresAt.getTime() <= startedAt) {
      await sessionAuth(deps.handle).deleteSession(sessionTokenHash);
      logAccess(c, startedAt, "401", { reviewerId: session.reviewerId });
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("ctx", { installationId: session.installationId });
    c.set("session", session);
    c.set("gateStartedAt", startedAt);
    await next();
  };
}

/**
 * Layer 2 — verify the resolved session's GitHub access to `:repoId`. Requires
 * `sessionLayer` to have run. The positive cache is created HERE — once per
 * layer instance (one per `createApp`) — so it is never shared across tests or
 * app instances.
 */
export function repoAuthzLayer(deps: AuthRouteDeps): MiddlewareHandler<AuthzEnv> {
  // key `${sessionTokenHash}:${repoId}` → the GitHub-verified `owner/name`,
  // until expiry. Positive only, bounded (never-reused keys can't be allowed
  // to grow unbounded). Storing the verified full name (not just `true`) lets
  // name-addressed GitHub calls downstream reuse the authz check's result
  // instead of trusting the row's possibly-stale `repo_slug`.
  const positiveCache = createTtlCache<string>(POSITIVE_CACHE_MAX_ENTRIES);

  return async (c, next) => {
    const startedAt = c.get("gateStartedAt");
    const session = c.get("session");

    // Tenant is the session's installation; parse+brand the repo id. An
    // ill-shaped id is a 404 (never 400 — no shape leak either).
    const repoId = parseRepoId(c.req.param("repoId"));
    if (repoId === undefined) {
      logAccess(c, startedAt, "404", { reviewerId: session.reviewerId });
      return c.json({ error: "not found" }, 404);
    }

    // Positive-cache hit → already authorized within the TTL; skip GitHub
    // entirely. The diff route decrypts the session token lazily if it needs
    // it, so no access token is set here. The cached value IS the verified
    // full name from the check that populated the entry (≤60s old).
    const cacheKey = positiveCacheKey(session.sessionTokenHash, repoId);
    const cachedFullName = positiveCache.get(cacheKey);
    if (cachedFullName !== undefined) {
      c.set("repoId", repoId);
      c.set("repoFullName", cachedFullName);
      await next();
      logAccess(c, startedAt, "200", { repoId, reviewerId: session.reviewerId });
      return;
    }

    // Cache miss → verify GitHub access with the viewer's token. Decrypt the
    // stored access token first; an unreadable token burns the session (401).
    const decrypted = await decryptToken(
      deps.auth.keyProvider,
      session.keyRef,
      session.ghTokenCiphertext,
    );
    if (!decrypted.ok) {
      await sessionAuth(deps.handle).deleteSession(session.sessionTokenHash);
      logAccess(c, startedAt, "401", { repoId, reviewerId: session.reviewerId });
      return c.json({ error: "unauthorized" }, 401);
    }

    // The session/token we carry forward — updated if a refresh rotates them.
    let currentSession = session;
    let accessToken = decrypted.value;
    let repo = await fetchRepositoryById(createUserOctokit(accessToken), repoId);

    // 401 from GitHub → the ~8h access token expired. Refresh (serialized) and
    // retry the access check ONCE with the rotated token.
    if (!repo.ok && repo.error.status === 401) {
      const refreshed = await refreshSessionToken(deps, currentSession);
      if (!refreshed.ok) {
        // The orchestrator already deleted the session on a hard failure.
        logAccess(c, startedAt, "401", { repoId, reviewerId: currentSession.reviewerId });
        return c.json({ error: "unauthorized" }, 401);
      }
      currentSession = refreshed.value.session;
      accessToken = refreshed.value.accessToken;
      repo = await fetchRepositoryById(createUserOctokit(accessToken), repoId);
    }

    // Any other non-2xx (403/404/5xx), or a retry that is still non-2xx →
    // collapse to 404 (no existence leak) AND emit the D9 denial. Never cached.
    if (!repo.ok) {
      await audit(deps.handle, {
        installationId: c.get("ctx").installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        action: AuditAction.AUTH,
        targetType: "repo",
        targetId: repoId,
        metadata: { [AuditMetadataKey.DECISION]: "404" },
      });
      logAccess(c, startedAt, "404", { repoId, reviewerId: currentSession.reviewerId });
      return c.json({ error: "not found" }, 404);
    }

    // 2xx → authorized. Cache the verified full name, hand the token to the
    // route, and log AFTER the handler so status/duration reflect it.
    positiveCache.set(cacheKey, repo.value.fullName, Date.now() + AUTHZ_CACHE_TTL_MS);
    c.set("session", currentSession);
    c.set("repoId", repoId);
    c.set("repoFullName", repo.value.fullName);
    c.set("accessToken", accessToken);
    await next();
    logAccess(c, startedAt, "200", { repoId, reviewerId: currentSession.reviewerId });
  };
}

/**
 * The per-repo gate: `sessionLayer` ∘ `repoAuthzLayer`. One enforcement point,
 * built once per app instance (so the positive cache is app-scoped).
 */
export function createAuthzMiddleware(deps: AuthRouteDeps): MiddlewareHandler<AuthzEnv> {
  return every(sessionLayer(deps), repoAuthzLayer(deps));
}

/**
 * Success/deny access line for a session-only composition (the list endpoint):
 * `sessionLayer` logs its own 401s BEFORE the handler; this layer, mounted
 * after it, emits the one D9 line for everything that reached the handler —
 * decision = the response status the handler actually returned.
 */
export function accessLogLayer(): MiddlewareHandler<AuthzEnv> {
  return async (c, next) => {
    await next();
    const line: Record<string, string | number> = {
      evt: "read",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - c.get("gateStartedAt"),
      decision: String(c.res.status),
      reviewerId: String(c.get("session").reviewerId),
    };
    console.info(JSON.stringify(line));
  };
}
