// The reviewer authorization gate (BRIEF-2 stage 7, PR C — ADR 0016 #5's
// SINGLE enforcement point, plan decision #4). One middleware sits in front of
// every read route under `/api/repos/:repoId/*` and, per request:
//   1. resolves the reviewer's session from the opaque cookie (no cookie /
//      unknown session → 401 — never a hint that the repo exists);
//   2. verifies the viewer actually has GitHub access to the target repo by its
//      NUMERIC id (`GET /repositories/{id}` with the viewer's own token —
//      rename-proof); any non-2xx collapses to 404 (no existence leak) and
//      emits the D9 `auth` denial audit row;
//   3. shapes the request context (`ctx`, `session`, `accessToken`, `repoId`)
//      for the read handlers and calls `next()`.
//
// REFRESH (D11): a 401 from GitHub means the viewer's ~8h access token expired;
// the middleware runs the serialized `refreshSessionToken` orchestrator and
// retries the access check ONCE with the rotated token. A refresh failure has
// already deleted the session, so it is a clean 401 → re-login.
//
// LOGGING (D9): each request emits ONE structured stdout access line
// (method/path/status/latency + numeric repo/reviewer ids) — the purgeable web
// access log, NOT the never-purged audit ledger, and NEVER any token/cookie/PII.
import type { MiddlewareHandler } from "hono";
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

// ---------------------------------------------------------------------------
// Typed Hono context vars. Handlers read these safely (no `any`): `ctx`/
// `session`/`repoId` are always set once the gate passes; `accessToken` is set
// after the GitHub access check succeeds.
// ---------------------------------------------------------------------------

export interface AuthzVariables {
  readonly ctx: TenantContext;
  readonly session: ReviewerSessionRow;
  readonly repoId: RepoId;
  /**
   * The repo's `owner/name` as GITHUB verified it during the access check
   * for this request. Routes that call GitHub by name (the diff proxy) MUST use
   * this, never the row's stored `repo_slug`: a rename + name-reuse could
   * otherwise point the stored slug at a DIFFERENT repo than the numeric id the
   * gate authorized.
   */
  readonly repoFullName: string;
  readonly accessToken?: string;
}

export interface AuthzEnv {
  readonly Variables: AuthzVariables;
}

/** The access-check decision, as it appears in the stdout access log. */
type AccessDecision = "200" | "401" | "404";

/** Brand a `:repoId` path segment; `undefined` when it isn't a positive int. */
function parseRepoId(raw: string | undefined): RepoId | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  return isRepoId(value) ? value : undefined;
}

/**
 * Build the authorization middleware over injected deps.
 */
export function createAuthzMiddleware(deps: AuthRouteDeps): MiddlewareHandler<AuthzEnv> {
  return async (c, next) => {
    const startedAt = Date.now();

    /**
     * One purgeable stdout access line — numeric ids only, never a token.
     * `decision` is the GATE's outcome; `status` is the RESPONSE status. On
     * deny paths they coincide; on the allowed path this is called AFTER
     * `next()`, so `status` reflects what the handler actually returned and
     * `durationMs` includes handler time (the D9 log contract).
     */
    const logAccess = (
      decision: AccessDecision,
      fields: { repoId?: RepoId; reviewerId?: bigint },
    ): void => {
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
    };

    // 1. Resolve the session from the opaque cookie. No cookie / unknown
    //    session both → 401 with no GitHub call and no repo-existence hint.
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie === undefined) {
      logAccess("401", {});
      return c.json({ error: "unauthorized" }, 401);
    }
    const sessionTokenHash = sha256Hex(cookie);
    const session = await sessionAuth(deps.handle).findSession(sessionTokenHash);
    if (session === undefined) {
      logAccess("401", {});
      return c.json({ error: "unauthorized" }, 401);
    }
    // `findSession` is a plain resolver (it doesn't filter on expiry), so expiry
    // is enforced HERE, at the auth decision point. `expires_at` tracks the ~6mo
    // refresh-token lifetime: once it's past, the refresh token itself is dead,
    // so there is no recovery — burn the row and force a fresh login. (An expired
    // ~8h ACCESS token is different — it still flows through the 401→refresh path
    // below.)
    if (session.expiresAt.getTime() <= startedAt) {
      await sessionAuth(deps.handle).deleteSession(sessionTokenHash);
      logAccess("401", { reviewerId: session.reviewerId });
      return c.json({ error: "unauthorized" }, 401);
    }

    // 2. Tenant is the session's installation; parse+brand the repo id. An
    //    ill-shaped id is a 404 (never 400 — no shape leak either).
    const ctx: TenantContext = { installationId: session.installationId };
    const repoId = parseRepoId(c.req.param("repoId"));
    if (repoId === undefined) {
      logAccess("404", { reviewerId: session.reviewerId });
      return c.json({ error: "not found" }, 404);
    }

    // 3. Verify GitHub access with the viewer's token on every read. Decrypt the
    //    stored access token first; an unreadable token burns the session (401).
    const decrypted = await decryptToken(
      deps.auth.keyProvider,
      session.keyRef,
      session.ghTokenCiphertext,
    );
    if (!decrypted.ok) {
      await sessionAuth(deps.handle).deleteSession(sessionTokenHash);
      logAccess("401", { repoId, reviewerId: session.reviewerId });
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
        logAccess("401", { repoId, reviewerId: currentSession.reviewerId });
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
        installationId: ctx.installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        action: AuditAction.AUTH,
        targetType: "repo",
        targetId: repoId,
        metadata: { [AuditMetadataKey.DECISION]: "404" },
      });
      logAccess("404", { repoId, reviewerId: currentSession.reviewerId });
      return c.json({ error: "not found" }, 404);
    }

    // 2xx → authorized. Hand the verified full name + token to the route and log
    // AFTER the handler so status/duration reflect it.
    c.set("ctx", ctx);
    c.set("session", currentSession);
    c.set("repoId", repoId);
    c.set("repoFullName", repo.value.fullName);
    c.set("accessToken", accessToken);
    await next();
    logAccess("200", { repoId, reviewerId: currentSession.reviewerId });
  };
}
