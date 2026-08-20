// The reviewer authorization gate — the SINGLE enforcement point, built from
// two composable layers with two compositions:
//   `sessionLayer`   — opaque cookie → session row → expiry → tenant ctx (no
//                      cookie / unknown / expired session → 401 — never a hint
//                      that the repo exists). Reused ALONE by session-scoped
//                      endpoints (the PR list) that carry no `:repoId`.
//   `repoAuthzLayer` — parse+brand `:repoId`, verify the viewer's GitHub access
//                      to the repo by its NUMERIC id (`GET /repositories/{id}`
//                      with the viewer's own token — rename-proof); any non-2xx
//                      collapses to 404 (no existence leak) and names the
//                      denial for the audit choke point; on success shapes the request
//                      context (`repoId`, `repoFullName`, `accessToken`).
// `createAuthzMiddleware` = the composition of both — the per-repo gate in
// front of every read under `/api/repos/:repoId/*`.
//
// CACHING: a POSITIVE cache keyed `(sessionHash, repoId)` with a 60s TTL skips
// the GitHub round-trip on repeat authorized reads. NEGATIVES ARE NEVER CACHED
// — a revoked grant must re-deny on the very next request; a granted-then-
// revoked viewer is stale for at most 60s. The cache is a closure created ONCE
// per `repoAuthzLayer`, so tests get a fresh cache per `createApp`.
//
// REFRESH: a 401 from GitHub means the viewer's ~8h access token expired; the
// layer runs the serialized `refreshSessionToken` orchestrator and retries the
// access check ONCE with the rotated token. A refresh failure has already
// deleted the session, so it is a clean 401 → re-login.
//
// LOGGING: each request gets ONE structured access line (method/path/status/
// latency/decision + numeric repo/reviewer ids + reqId) — the purgeable web
// access log, NOT the never-purged audit ledger, and NEVER any
// token/cookie/PII. The line itself is emitted by the `requestLogging`
// middleware after the handler; the layers here only STAMP the gate's decision
// into context via `stampAccess`. `sessionLayer` stamps its own denials; the
// last layer in a composition stamps the allowed path after the handler. A
// session-only composition appends `accessStampLayer` so its line carries the
// reviewer id.
import type { MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { getCookie } from "hono/cookie";
import { createUserOctokit, fetchRepositoryById } from "github";
import {
  decryptToken,
  isRepoId,
  sessionAuth,
  tokenAuth,
  type InstallationId,
  type RepoId,
  type TenantContext,
} from "persistence";
import {
  principalFromApiToken,
  principalFromSession,
  refreshSessionToken,
  SESSION_COOKIE,
  sha256Hex,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "./auth/session";
import {
  AUDIT_REASON_NO_REPO_ACCESS,
  stampAuditReason,
  stampAuditTarget,
} from "../product-operations/audit";
import { stampAccess, type RequestLogVariables } from "../request-logging";
import { createTtlCache } from "./ttl-cache";
import { ApiErrorCode, errorJson } from "../error-response";

// ---------------------------------------------------------------------------
// Typed Hono context vars. Handlers read these safely (no `any`): `ctx`/
// `session` are set once `sessionLayer` passes; `repoId`/`repoFullName` once
// `repoAuthzLayer` passes; `accessToken` only on the GitHub-verified path (a
// positive-cache hit skips the decrypt, so the diff route decrypts lazily from
// `session` when it is absent).
// ---------------------------------------------------------------------------

export interface AuthzVariables extends RequestLogVariables {
  readonly ctx: TenantContext;
  readonly session: ViewerPrincipal;
  readonly repoId: RepoId;
  /**
   * The repo's `owner/name` as GITHUB verified it during the access check
   * (cached with the positive entry, so ≤60s stale). Routes that call GitHub
   * by name (the diff proxy) MUST use this, never the row's stored `repo_slug`:
   * a rename + name-reuse could otherwise point the stored slug at a DIFFERENT
   * repo than the numeric id the gate authorized.
   */
  readonly repoFullName: string;
  /**
   * Whether GITHUB reported push (write) permission for the viewer on this
   * repo during the access check — cached with the positive entry, so ≤60s
   * stale like `repoFullName`. For writes it is an affordance signal only:
   * GitHub's mutation-time enforcement stays the truth. It is also a SECURITY
   * GATE on the collaborators read (an installation-token fetch has no
   * GitHub-side backstop), so a probe shape without a `permissions` block must
   * keep parsing as `false` — never loosen the default.
   */
  readonly viewerCanPush: boolean;
  readonly accessToken?: string;
}

export interface AuthzEnv {
  readonly Variables: AuthzVariables;
}

/**
 * Positive-cache TTL — short enough that a revoked grant self-heals fast. The
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

/** `Authorization` scheme + the opaque token's secret-scanner-friendly prefix. */
const BEARER_SCHEME = "Bearer ";
export const API_TOKEN_PREFIX = "mergebrief_";
/** `last_used_at` is visibility metadata — one write per token per window. */
const TOKEN_TOUCH_THROTTLE_MS = 60 * 1000;
/** Bounded like the positive cache: token hashes are long-lived but finite. */
const TOUCH_THROTTLE_MAX_ENTRIES = 50_000;

/**
 * Keyed by session AND installation: an org switch rebinds the session row's
 * installation without rotating the cookie, so the hash alone would let a
 * pre-switch grant (or its verified name) be reused under the new tenant for
 * up to the TTL.
 */
function positiveCacheKey(
  sessionTokenHash: string,
  installationId: InstallationId,
  repoId: RepoId,
): string {
  return `${sessionTokenHash}:${String(installationId)}:${String(repoId)}`;
}

/** Brand a `:repoId` path segment; `undefined` when it isn't a positive int. */
function parseRepoId(raw: string | undefined): RepoId | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  return isRepoId(value) ? value : undefined;
}

// Gate outcomes reach the access line via `stampAccess` — numeric ids only,
// never a token. `decision` is the GATE's outcome; the line's `status` is the
// RESPONSE status. On the allowed path the stamp lands AFTER `next()`, so
// `status`/`durationMs` reflect what the handler actually returned.

/**
 * Layer 1 — resolve the reviewer session and tenant ctx from the opaque
 * cookie. Denies with 401 (stamping its own access decision); on success
 * sets `ctx`/`session` and defers the stamp to the composition's last layer.
 */
export function sessionLayer(deps: AuthRouteDeps): MiddlewareHandler<AuthzEnv> {
  // Throttle for the Bearer `last_used_at` touch: at most one UPDATE per token
  // per window, app-instance-scoped like the positive cache.
  const touchThrottle = createTtlCache<true>(TOUCH_THROTTLE_MAX_ENTRIES);

  return async (c, next) => {
    const startedAt = Date.now();

    // Bearer is accepted on `/api/*` EXCEPT `/api/auth/*` (login, logout,
    // token mint/list/revoke, installation binding stay cookie-only: a stolen
    // API token must never mint tokens or rebind sessions). Where not
    // accepted, the header is IGNORED (falls through to the cookie path),
    // never honored.
    const authorization = c.req.header("authorization");
    if (
      authorization !== undefined &&
      authorization.startsWith(BEARER_SCHEME) &&
      c.req.path.startsWith("/api/") &&
      !c.req.path.startsWith("/api/auth/")
    ) {
      const bearer = authorization.slice(BEARER_SCHEME.length);
      // Wrong prefix / miss / expired / revoked — the SAME hint-free 401.
      if (!bearer.startsWith(API_TOKEN_PREFIX)) {
        stampAccess(c, "401", {});
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }
      const tokenHash = sha256Hex(bearer);
      const resolved = await tokenAuth(deps.handle).resolveByHash(
        tokenHash,
        new Date(startedAt),
      );
      if (!resolved.ok) {
        stampAccess(c, "401", {});
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }
      const principal = principalFromApiToken(resolved.value);

      // Throttled usage stamp — visibility, not auth state; the write is
      // skipped entirely while the window holds and never awaited on the
      // request path (its outcome cannot change the 401/200 decision).
      if (touchThrottle.get(tokenHash) === undefined) {
        touchThrottle.set(tokenHash, true, startedAt + TOKEN_TOUCH_THROTTLE_MS);
        const log = c.get("logger");
        void tokenAuth(deps.handle)
          .touchLastUsed(tokenHash, new Date(startedAt))
          .catch((error: unknown) => {
            // Visibility metadata only — degraded, not operator-actionable.
            log.warn("api_token last_used_at touch failed", { err: error });
          });
      }

      c.set("ctx", { installationId: principal.installationId });
      c.set("session", principal);
      await next();
      return;
    }

    // No cookie / unknown session both → 401 with no GitHub call and no
    // repo-existence hint.
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie === undefined) {
      stampAccess(c, "401", {});
      return errorJson(c, ApiErrorCode.UNAUTHORIZED);
    }
    const sessionTokenHash = sha256Hex(cookie);
    const resolved = await sessionAuth(deps.handle).findSession(
      sessionTokenHash,
    );
    if (resolved === undefined) {
      stampAccess(c, "401", {});
      return errorJson(c, ApiErrorCode.UNAUTHORIZED);
    }
    // `findSession` is a plain resolver (it doesn't filter on expiry), so expiry
    // is enforced HERE, at the auth decision point. `expires_at` tracks the ~6mo
    // refresh-token lifetime: once it's past, the refresh token itself is dead,
    // so there is no recovery — burn the row and force a fresh login. (An expired
    // ~8h ACCESS token is different — it still flows through the 401→refresh path
    // in `repoAuthzLayer`.)
    if (resolved.session.expiresAt.getTime() <= startedAt) {
      await sessionAuth(deps.handle).deleteSession(sessionTokenHash);
      stampAccess(c, "401", { reviewerId: resolved.session.reviewerId });
      return errorJson(c, ApiErrorCode.UNAUTHORIZED);
    }

    c.set("ctx", { installationId: resolved.session.installationId });
    c.set("session", principalFromSession(resolved));
    await next();
    return;
  };
}

/**
 * Layer 2 — verify the resolved session's GitHub access to `:repoId`. Requires
 * `sessionLayer` to have run. The positive cache is created HERE — once per
 * layer instance (one per `createApp`) — so it is never shared across tests or
 * app instances.
 */
export function repoAuthzLayer(
  deps: AuthRouteDeps,
): MiddlewareHandler<AuthzEnv> {
  // key `${sessionTokenHash}:${repoId}` → the GitHub-verified `owner/name` +
  // the viewer's push capability, until expiry. Positive only. Storing the
  // verified full name (not just `true`) lets name-addressed GitHub calls
  // downstream reuse the authz check's result instead of trusting the row's
  // possibly-stale `repo_slug`.
  const positiveCache = createTtlCache<{
    readonly fullName: string;
    readonly viewerCanPush: boolean;
  }>(POSITIVE_CACHE_MAX_ENTRIES);

  return async (c, next) => {
    const session = c.get("session");

    // Tenant is the session's installation; parse+brand the repo id. An
    // ill-shaped id is a 404 (never 400 — no shape leak either).
    const repoId = parseRepoId(c.req.param("repoId"));
    if (repoId === undefined) {
      stampAccess(c, "404", { reviewerId: session.reviewerId });
      return errorJson(c, ApiErrorCode.NOT_FOUND);
    }

    // Positive-cache hit → already authorized within the TTL; skip GitHub
    // entirely. The diff route decrypts the session token lazily if it needs
    // it, so no access token is set here. The cached value IS the verified
    // full name from the check that populated the entry (≤60s old).
    const cacheKey = positiveCacheKey(
      session.sessionTokenHash,
      session.installationId,
      repoId,
    );
    const cachedEntry = positiveCache.get(cacheKey);
    if (cachedEntry !== undefined) {
      c.set("repoId", repoId);
      c.set("repoFullName", cachedEntry.fullName);
      c.set("viewerCanPush", cachedEntry.viewerCanPush);
      await next();
      stampAccess(c, "200", { repoId, reviewerId: session.reviewerId });
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
      stampAccess(c, "401", { repoId, reviewerId: session.reviewerId });
      return errorJson(c, ApiErrorCode.UNAUTHORIZED);
    }

    // The session/token we carry forward — updated if a refresh rotates them.
    let currentSession = session;
    let accessToken = decrypted.value;
    let repo = await fetchRepositoryById(
      createUserOctokit(accessToken),
      repoId,
    );

    // 401 from GitHub → the ~8h access token expired. Refresh (serialized) and
    // retry the access check ONCE with the rotated token.
    if (!repo.ok && repo.error.status === 401) {
      const refreshed = await refreshSessionToken(
        deps,
        currentSession,
        c.get("logger"),
      );
      if (!refreshed.ok) {
        // The orchestrator already deleted the session on a hard failure.
        stampAccess(c, "401", {
          repoId,
          reviewerId: currentSession.reviewerId,
        });
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }
      currentSession = refreshed.value.session;
      accessToken = refreshed.value.accessToken;
      repo = await fetchRepositoryById(createUserOctokit(accessToken), repoId);
    }

    // Any other non-2xx (403/404/5xx), or a retry that is still non-2xx →
    // collapse to 404 (no existence leak) AND emit the denial. Never cached.
    if (!repo.ok) {
      // The ledger names the real reason; the RESPONSE stays the uniform 404.
      // The row itself is written at the audit choke point — for an action;
      // a read is never audited, and this gate cannot tell them apart.
      stampAuditReason(c, AUDIT_REASON_NO_REPO_ACCESS);
      stampAuditTarget(c, "repo", repoId);
      stampAccess(c, "404", { repoId, reviewerId: currentSession.reviewerId });
      return errorJson(c, ApiErrorCode.NOT_FOUND);
    }

    // 2xx → authorized. Cache the verified full name, hand the token to the
    // route, and log AFTER the handler so status/duration reflect it.
    positiveCache.set(
      cacheKey,
      {
        fullName: repo.value.fullName,
        viewerCanPush: repo.value.viewerCanPush,
      },
      Date.now() + AUTHZ_CACHE_TTL_MS,
    );
    c.set("session", currentSession);
    c.set("repoId", repoId);
    c.set("repoFullName", repo.value.fullName);
    c.set("viewerCanPush", repo.value.viewerCanPush);
    c.set("accessToken", accessToken);
    await next();
    stampAccess(c, "200", { repoId, reviewerId: currentSession.reviewerId });
    return;
  };
}

/**
 * The per-repo gate: `sessionLayer` ∘ `repoAuthzLayer`. One enforcement point,
 * built once per app instance (so the positive cache is app-scoped).
 */
export function createAuthzMiddleware(
  deps: AuthRouteDeps,
): MiddlewareHandler<AuthzEnv> {
  return every(sessionLayer(deps), repoAuthzLayer(deps));
}

/**
 * Access stamp for a session-only composition (the list endpoint):
 * `sessionLayer` stamps its own 401s BEFORE the handler; this layer, mounted
 * after it, stamps everything that reached the handler — decision = the
 * response status the handler actually returned, plus the resolved reviewer
 * id the middleware's fallback wouldn't otherwise know.
 */
export function accessStampLayer(): MiddlewareHandler<AuthzEnv> {
  return async (c, next) => {
    await next();
    stampAccess(c, String(c.res.status), {
      reviewerId: c.get("session").reviewerId,
    });
  };
}
