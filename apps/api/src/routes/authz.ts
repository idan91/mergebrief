/* oxlint-disable house/comment-run -- the gate's contract: what each layer
   decides, what is cached and never cached, and what the access line carries.
   The layers below are read against it. */
// The reviewer authorization gate, the SINGLE enforcement point, built from
// two composable layers with two compositions:
//   `sessionLayer`: opaque cookie → session row → expiry → tenant ctx (no
//                      cookie / unknown / expired session → 401, never a hint
//                      that the repo exists). Reused ALONE by session-scoped
//                      endpoints (the PR list) that carry no `:repoId`.
//   `repoAuthzLayer`: parse+brand `:repoId`, verify the viewer's GitHub access
//                      to the repo by its NUMERIC id (`GET /repositories/{id}`
//                      with the viewer's own token, rename-proof); any non-2xx
//                      collapses to 404 (no existence leak) and names the
//                      denial for the audit choke point; on success resolves
//                      the installation holding the repo among those the
//                      viewer reaches (else the owner world) and shapes the
//                      request context (`ctx`, `repoId`, `repoFullName`,
//                      `accessToken`).
// `createAuthzMiddleware` = the composition of both, the per-repo gate in
// front of every read under `/api/repos/:repoId/*`.
//
// CACHING: a POSITIVE cache keyed `(sessionHash, repoId)` with a 60s TTL skips
// the GitHub round-trip on repeat authorized reads. NEGATIVES ARE NEVER CACHED:
// a revoked grant must re-deny on the very next request; a granted-then-
// revoked viewer is stale for at most 60s. The cache is a closure created ONCE
// per `repoAuthzLayer`, so tests get a fresh cache per `createApp`. One
// entry is a RESTRICTED positive rather than a plain one: the operator-PAT
// rung caches a read-only, owner-pinned pass keyed to its own PR, so a
// reader stays on that footing for the TTL even if the installation lands
// mid-window.
//
// REFRESH: a 401 from GitHub means the viewer's ~8h access token expired; the
// layer's `ReviewerGitHubClient` spends its one serialized refresh and retries
// the access check ONCE with the rotated token. A refresh failure has already
// deleted the session, so it is a clean 401 → re-login.
//
// LOGGING: each request gets ONE structured access line (method/path/status/
// latency/decision + numeric repo/reviewer ids + reqId), the purgeable web
// access log, NOT the never-purged audit ledger, and NEVER any
// token/cookie/PII. The line itself is emitted by the `requestLogging`
// middleware after the handler; the layers here only STAMP the gate's decision
// into context via `stampAccess`. `sessionLayer` stamps its own denials; the
// last layer in a composition stamps the allowed path after the handler. A
// session-only composition appends `accessStampLayer` so its line carries the
// reviewer id.
/* oxlint-enable house/comment-run */
import { ApiErrorCodes } from "contract";
import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { getCookie } from "hono/cookie";
import {
  createUserOctokit,
  fetchRepositoryById,
  type GitHubApiError,
} from "github";
import {
  isOwnerContext,
  isRepoId,
  createSessionAuth,
  createTenantRepository,
  createTokenAuth,
  type InstallationId,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import type { AuthRouteDeps, ViewerPrincipal } from "./auth/session/types";
import { SESSION_COOKIE } from "./auth/session/consts";
import { sha256Hex } from "./auth/session/utils";
import {
  derivePrincipalFromApiToken,
  derivePrincipalFromSession,
} from "./auth/session/logic/principal";
import {
  AUDIT_REASON_NO_REPO_ACCESS,
  stampAuditReason,
  stampAuditTarget,
} from "../product-operations/audit";
import { stampAccess, type RequestLogVariables } from "../request-logging";
import { createTtlCache } from "./ttl-cache";
import { BadGateway, NotFound, Unauthorized } from "../shared-errors/api-error";
import { isGitHubDenial } from "../shared-errors/failures";
import { createReviewerGitHubClient } from "./auth/reviewer-github-client";
import type { InstallationResolver, RepoWorld } from "./installation-resolver";

// ---------------------------------------------------------------------------
// Typed Hono context vars. Handlers read these safely (no `any`): `ctx`/
// `session` are set once `sessionLayer` passes; `repoId`/`repoFullName` once
// `repoAuthzLayer` passes; `accessToken` only on the GitHub-verified path (a
// positive-cache hit skips the decrypt, so the diff route decrypts lazily from
// `session` when it is absent).
// ---------------------------------------------------------------------------

export interface AuthzVariables extends RequestLogVariables {
  /**
   * Behind `sessionLayer` alone, the credential's stored world. Behind the
   * repo gate, the world the REPO resolved into: the installation that holds
   * it among those the viewer reaches, else the viewer's owner world.
   */
  readonly ctx: ScopeContext;
  /**
   * The gate let this request through on the operator PAT, not the reader's
   * own token. Per-PR routes must then read the reader's OWN url-box world:
   * nothing the installation owns was proven readable to them.
   */
  readonly urlBoxOnly?: boolean;
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
   * repo during the access check, cached with the positive entry, so ≤60s
   * stale like `repoFullName`. For writes it is an affordance signal only:
   * GitHub's mutation-time enforcement stays the truth. It is also a SECURITY
   * GATE on the collaborators read (an installation-token fetch has no
   * GitHub-side backstop), so a probe shape without a `permissions` block must
   * keep parsing as `false`, never loosen the default.
   */
  readonly viewerCanPush: boolean;
  readonly accessToken?: string;
}

export interface AuthzEnv {
  readonly Variables: AuthzVariables;
}

/**
 * Positive-cache TTL: short enough that a revoked grant self-heals fast. The
 * per-session allowed-repo-set cache deliberately shares this constant.
 */

export const AUTHZ_CACHE_TTL_MS = 60 * 1000;
/**
 * Hard cap on live positive-cache entries (one per session×repo). Bounds memory
 * regardless of process uptime: session hashes are one-time-random, so keys are
 * never reused and would otherwise accumulate forever. Generous for M1 self-host
 * (a handful of reviewers × repos); the oldest entry is evicted past the cap.
 */
const POSITIVE_CACHE_MAX_ENTRIES = 50_000;

/** `Authorization` scheme + the opaque token's secret-scanner-friendly prefix. */
const BEARER_SCHEME = "Bearer ";
export const API_TOKEN_PREFIX = "mergebrief_";
/** `last_used_at` is visibility metadata, one write per token per window. */
const TOKEN_TOUCH_THROTTLE_MS = 60 * 1000;
/** Bounded like the positive cache: token hashes are long-lived but finite. */
const TOUCH_THROTTLE_MAX_ENTRIES = 50_000;

/**
 * Keyed by credential and repo. The entry carries the world the repo was
 * resolved into, so a grant replays under the installation it was proven
 * for and never under another.
 */
function positiveCacheKey(sessionTokenHash: string, repoId: RepoId): string {
  return `${sessionTokenHash}:${String(repoId)}`;
}

/** The request context a resolved world addresses. */
function deriveScopeContext(
  world: RepoWorld,
  reviewerId: ReviewerId,
): ScopeContext {
  return world.kind === "installation"
    ? { installationId: world.installationId }
    : { ownerUserId: reviewerId };
}

/**
 * The installation the ctx addresses, for routes whose surface exists only
 * in the App world (installation-port GitHub calls, per-tenant caches). An
 * owner-scoped viewer gets the uniform 404, the resource genuinely does not
 * exist in their world.
 */
export function requireInstallationScope(ctx: ScopeContext): InstallationId {
  if (isOwnerContext(ctx)) {
    throw new NotFound();
  }
  return ctx.installationId;
}

/** Brand a `:repoId` path segment; `undefined` when it isn't a positive int. */
function parseRepoId(raw: string | undefined): RepoId | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  return isRepoId(value) ? value : undefined;
}

/** The `:prNumber` path segment, or undefined off the per-PR subtree. */
function resolvePrNumberParam(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * The gate's second rung. Answers with the repo ONLY when every condition
 * holds: the denial is a 404/403 (not upstream trouble), an operator PAT is
 * configured, the request names a PR, that PR exists in the reader's OWN
 * url-box world, and the PAT can read the repo. Otherwise `undefined` and
 * the caller collapses to the uniform 404 exactly as before.
 */
async function resolveRepoUnderFallback(
  deps: AuthRouteDeps,
  c: Context<AuthzEnv>,
  repoId: RepoId,
  reviewerId: ReviewerId,
  error: GitHubApiError,
): Promise<
  { readonly fullName: string; readonly prNumber: number } | undefined
> {
  const fallbackToken = deps.urlBoxFallbackToken;
  if (fallbackToken === undefined || !isGitHubDenial(error)) {
    return undefined;
  }
  const prNumber = resolvePrNumberParam(c.req.param("prNumber"));
  if (prNumber === undefined) {
    return undefined;
  }
  const owned = await createTenantRepository(deps.handle, {
    ownerUserId: reviewerId,
  }).pullRequests.getByNumber(repoId, prNumber);
  if (owned === undefined) {
    return undefined;
  }
  const repo = await fetchRepositoryById(
    createUserOctokit(fallbackToken),
    repoId,
  );
  return repo.ok ? { fullName: repo.value.fullName, prNumber } : undefined;
}

// Gate outcomes reach the access line via `stampAccess`, numeric ids only,
// never a token. `decision` is the GATE's outcome; the line's `status` is the
// RESPONSE status. On the allowed path the stamp lands AFTER `next()`, so
// `status`/`durationMs` reflect what the handler actually returned.

/**
 * Layer 1: resolve the reviewer session and tenant ctx from the opaque
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
    // token mint/list/revoke stay cookie-only: a stolen API token must never
    // mint tokens). Where not
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
      // Wrong prefix / miss / expired / revoked, the SAME hint-free 401.
      if (!bearer.startsWith(API_TOKEN_PREFIX)) {
        stampAccess(c, "401", {});
        throw new Unauthorized();
      }
      const tokenHash = sha256Hex(bearer);
      const resolved = await createTokenAuth(deps.handle).resolveByHash(
        tokenHash,
        new Date(startedAt),
      );
      if (!resolved.ok) {
        stampAccess(c, "401", {});
        throw new Unauthorized();
      }
      const principal = derivePrincipalFromApiToken(resolved.value);

      // Throttled usage stamp, visibility, not auth state; the write is
      // skipped entirely while the window holds and never awaited on the
      // request path (its outcome cannot change the 401/200 decision).
      if (touchThrottle.get(tokenHash) === undefined) {
        touchThrottle.set(tokenHash, true, startedAt + TOKEN_TOUCH_THROTTLE_MS);
        const log = c.get("logger");
        void createTokenAuth(deps.handle)
          .touchLastUsed(tokenHash, new Date(startedAt))
          .catch((error: unknown) => {
            // Visibility metadata only, degraded, not operator-actionable.
            log.warn("api_token last_used_at touch failed", { err: error });
          });
      }

      // A token binds no installation: behind the repo gate the resolver
      // names the world; a session-only route reads the owner world.
      c.set("ctx", { ownerUserId: principal.reviewerId });
      c.set("session", principal);
      await next();
      return;
    }

    // No cookie / unknown session both → 401 with no GitHub call and no
    // repo-existence hint.
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie === undefined) {
      stampAccess(c, "401", {});
      throw new Unauthorized();
    }
    const sessionTokenHash = sha256Hex(cookie);
    const resolved = await createSessionAuth(deps.handle).findSession(
      sessionTokenHash,
    );
    if (resolved === undefined) {
      stampAccess(c, "401", {});
      throw new Unauthorized();
    }
    // `findSession` is a plain resolver (it doesn't filter on expiry), so expiry
    // is enforced HERE, at the auth decision point. `expires_at` tracks the ~6mo
    // refresh-token lifetime: once it's past, the refresh token itself is dead,
    // so there is no recovery, burn the row and force a fresh login. (An expired
    // ~8h ACCESS token is different, it still flows through the 401→refresh path
    // in `repoAuthzLayer`.)
    if (resolved.session.expiresAt.getTime() <= startedAt) {
      await createSessionAuth(deps.handle).deleteSession(sessionTokenHash);
      stampAccess(c, "401", { reviewerId: resolved.session.reviewerId });
      throw new Unauthorized();
    }

    // No credential holds an installation: a session-only route acts in the
    // owner world; behind the repo gate the resolver names the world.
    c.set("ctx", { ownerUserId: resolved.session.reviewerId });
    c.set("session", derivePrincipalFromSession(resolved));
    await next();
    return;
  };
}

/**
 * Layer 2: verify the resolved session's GitHub access to `:repoId`. Requires
 * `sessionLayer` to have run. The positive cache is created HERE, once per
 * layer instance (one per `createApp`), so it is never shared across tests or
 * app instances.
 */
export function repoAuthzLayer(
  deps: AuthRouteDeps,
  installations: InstallationResolver,
): MiddlewareHandler<AuthzEnv> {
  // key `${sessionTokenHash}:${repoId}` → the GitHub-verified `owner/name` +
  // the viewer's push capability, until expiry. Positive only. Storing the
  // verified full name (not just `true`) lets name-addressed GitHub calls
  // downstream reuse the authz check's result instead of trusting the row's
  // possibly-stale `repo_slug`.
  const positiveCache = createTtlCache<{
    readonly fullName: string;
    readonly viewerCanPush: boolean;
    /**
     * The PR whose owned url-box row earned this entry on the operator-PAT
     * rung, or undefined for an ordinary pass. The cache key is per-repo, so
     * without it one PAT-carried pass would clear the gate for every PR in
     * the repo until the TTL expired.
     */
    readonly ownerPinnedPr: number | undefined;
    /** The world the repo resolved into; replayed on a hit. */
    readonly world: RepoWorld;
  }>(POSITIVE_CACHE_MAX_ENTRIES);

  return async (c, next) => {
    const session = c.get("session");

    // Parse+brand the repo id. An ill-shaped id is a 404 (never 400, no
    // shape leak either).
    const repoId = parseRepoId(c.req.param("repoId"));
    if (repoId === undefined) {
      stampAccess(c, "404", { reviewerId: session.reviewerId });
      throw new NotFound();
    }

    // Positive-cache hit → already authorized within the TTL; skip GitHub
    // entirely. The diff route decrypts the session token lazily if it needs
    // it, so no access token is set here. The cached value IS the verified
    // full name from the check that populated the entry (≤60s old).
    const cacheKey = positiveCacheKey(session.sessionTokenHash, repoId);
    const cached = positiveCache.get(cacheKey);
    // A PAT-carried entry serves ONLY the PR it was granted for; any other
    // PR under the repo re-runs the whole ladder.
    const cachedEntry =
      cached?.ownerPinnedPr !== undefined &&
      cached.ownerPinnedPr !== resolvePrNumberParam(c.req.param("prNumber"))
        ? undefined
        : cached;
    if (cachedEntry !== undefined) {
      if (cachedEntry.ownerPinnedPr !== undefined) {
        c.set("urlBoxOnly", true);
      }
      c.set("ctx", deriveScopeContext(cachedEntry.world, session.reviewerId));
      c.set("repoId", repoId);
      c.set("repoFullName", cachedEntry.fullName);
      c.set("viewerCanPush", cachedEntry.viewerCanPush);
      await next();
      stampAccess(c, "200", { repoId, reviewerId: session.reviewerId });
      return;
    }

    // Cache miss → verify GitHub access with the viewer's token through the
    // per-request client: lazy single decrypt, refresh-once on a 401, retry
    // once with the rotated token.
    const client = createReviewerGitHubClient(deps, session, c.get("logger"));
    let attempts = 0;
    let accessToken = "";
    const repo = await client.run((token) => {
      attempts += 1;
      accessToken = token;
      return fetchRepositoryById(createUserOctokit(token), repoId);
    });

    if (!repo.ok) {
      // An unreadable stored token burns the session (401).
      if ("kind" in repo.error) {
        await createSessionAuth(deps.handle).deleteSession(
          session.sessionTokenHash,
        );
        stampAccess(c, "401", { repoId, reviewerId: session.reviewerId });
        throw new Unauthorized();
      }
      // A 401 with no retry spent means the refresh itself failed, the
      // orchestrator already deleted the session; clean 401 → re-login.
      if (repo.error.status === 401 && attempts === 1) {
        stampAccess(c, "401", {
          repoId,
          reviewerId: client.session().reviewerId,
        });
        throw new Unauthorized();
      }
      // Second rung: the url-box door generates behind the operator PAT, so
      // without it a reader holds briefs they cannot open. Narrowed to a PR
      // this reader owns in the url-box world, never an App-world PR.
      const fallbackRepo = await resolveRepoUnderFallback(
        deps,
        c,
        repoId,
        client.session().reviewerId,
        repo.error,
      );
      if (fallbackRepo !== undefined) {
        // The PAT's push right is not the reader's: no write affordance.
        const world: RepoWorld = { kind: "owner" };
        const entry = {
          fullName: fallbackRepo.fullName,
          viewerCanPush: false,
          ownerPinnedPr: fallbackRepo.prNumber,
          world,
        };
        positiveCache.set(cacheKey, entry, Date.now() + AUTHZ_CACHE_TTL_MS);
        const fallbackSession = client.session();
        c.set("session", fallbackSession);
        c.set("ctx", deriveScopeContext(world, fallbackSession.reviewerId));
        c.set("urlBoxOnly", true);
        c.set("repoId", repoId);
        c.set("repoFullName", entry.fullName);
        c.set("viewerCanPush", false);
        await next();
        stampAccess(c, "200-url-box", {
          repoId,
          reviewerId: fallbackSession.reviewerId,
        });
        return;
      }
      // Any other non-2xx (403/404/5xx), or a retry that is still non-2xx →
      // collapse to 404 (no existence leak) AND emit the denial. Never
      // cached. The ledger names the real reason; the RESPONSE stays the
      // uniform 404. The row itself is written at the audit choke point
      // for an action; a read is never audited, and this gate cannot tell
      // them apart.
      stampAuditReason(c, AUDIT_REASON_NO_REPO_ACCESS);
      stampAuditTarget(c, "repo", repoId);
      stampAccess(c, "404", {
        repoId,
        reviewerId: client.session().reviewerId,
      });
      throw new NotFound();
    }

    // 2xx → the viewer can read the repo. Which installation holds it is a
    // second question; a failure answering it is never cached.
    const resolved = await installations.resolveInstallationForRepo(
      client.session(),
      repoId,
      c.get("logger"),
    );
    if (!resolved.ok) {
      const { status } = resolved.error;
      stampAccess(c, String(status), {
        repoId,
        reviewerId: client.session().reviewerId,
      });
      if (status === 401) {
        throw new Unauthorized();
      }
      throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
    }

    const { world, session: currentSession, expiresAt } = resolved.value;
    // Capped to the world's own expiry, so the three caches never stack.
    positiveCache.set(
      cacheKey,
      {
        fullName: repo.value.fullName,
        viewerCanPush: repo.value.viewerCanPush,
        ownerPinnedPr: undefined,
        world,
      },
      Math.min(Date.now() + AUTHZ_CACHE_TTL_MS, expiresAt),
    );
    c.set("ctx", deriveScopeContext(world, currentSession.reviewerId));
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
  installations: InstallationResolver,
): MiddlewareHandler<AuthzEnv> {
  return every(sessionLayer(deps), repoAuthzLayer(deps, installations));
}

/**
 * Access stamp for a session-only composition (the list endpoint):
 * `sessionLayer` stamps its own 401s BEFORE the handler; this layer, mounted
 * after it, stamps everything that reached the handler, decision = the
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

/**
 * The operator PAT, but only for a request the gate passed on it, a read
 * behind such a pass has to reach GitHub the same way the gate did, or the
 * page opens onto empty diffs and conversations. `undefined` everywhere
 * else, so an ordinary request can never borrow the operator's reach.
 */
export function readFallbackTokenFor(
  c: Context<AuthzEnv>,
  deps: AuthRouteDeps,
): string | undefined {
  return c.get("urlBoxOnly") === true ? deps.urlBoxFallbackToken : undefined;
}
