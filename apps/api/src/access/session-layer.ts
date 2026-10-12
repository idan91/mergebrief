// The session layer: opaque cookie or Bearer token → principal → expiry →
// owner ctx. No credential, an unknown one or an expired session is a 401
// with no hint that any repo exists: `signed-out` on the cookie path, the
// plain `unauthorized` for a Bearer token. Reused ALONE by session-scoped
// endpoints that carry no `:repoId`; the repo gate composes it first.
import { ApiErrorCodes } from "contract";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import {
  createSessionAuth,
  createTokenAuth,
  type ReviewerId,
} from "persistence";
import {
  AUDIT_REASON_CROSS_ORIGIN,
  stampAuditReason,
  stampAuditScope,
} from "../product-operations/audit";
import { stampAccess } from "../request-logging";
import { SESSION_COOKIE } from "../routes/auth/session/consts";
import {
  derivePrincipalFromApiToken,
  derivePrincipalFromSession,
} from "../routes/auth/session/logic/principal";
import {
  isSafeMethod,
  isSameOriginRequest,
  readOriginHeaders,
  resolveAllowedOrigin,
} from "../routes/auth/session/logic/same-origin";
import type { AuthRouteDeps } from "../routes/auth/session/types";
import { sha256Hex } from "../routes/auth/session/utils";
import { createTtlCache } from "../routes/ttl-cache";
import { Forbidden, Unauthorized } from "../shared-errors/api-error";
import {
  API_TOKEN_PREFIX,
  BEARER_SCHEME,
  TOKEN_TOUCH_THROTTLE_MS,
  TOUCH_THROTTLE_MAX_ENTRIES,
} from "./consts";
import type { AuthzEnv } from "./types";

/**
 * A cookie rides on every request the browser sends, whoever built it, so a
 * cookie principal on a state-changing method must prove the request came
 * from this instance's own origin. Bearer never rides ambient and needs no
 * such proof. The layer calls it after the principal is set, so the ledger
 * records who the request was aimed at; logout, outside the layer, calls it
 * with no principal. The wire stays a plain 403 either way.
 */
export function requireSameOrigin(
  c: Context<AuthzEnv>,
  allowedOrigin: string,
  reviewerId?: ReviewerId,
): void {
  if (isSafeMethod(c.req.method)) {
    return;
  }
  const headers = readOriginHeaders(c.req);
  if (isSameOriginRequest(headers, allowedOrigin)) {
    return;
  }
  const fields: { reviewerId?: ReviewerId } = {};
  if (reviewerId !== undefined) {
    fields.reviewerId = reviewerId;
  }
  stampAuditReason(c, AUDIT_REASON_CROSS_ORIGIN);
  stampAccess(c, "403-cross-origin", fields);
  c.get("logger").warn("cookie mutation refused: origin is not this instance", {
    secFetchSite: headers.secFetchSite,
    originPresent: headers.origin !== undefined,
  });
  throw new Forbidden();
}

/**
 * Resolve the reviewer session and tenant ctx from the opaque cookie or a
 * Bearer token. Denies with 401 (stamping its own access decision); on
 * success sets `ctx`/`session` and defers the stamp to the composition's
 * last layer.
 */
export function sessionLayer(deps: AuthRouteDeps): MiddlewareHandler<AuthzEnv> {
  // Throttle for the Bearer `last_used_at` touch: at most one UPDATE per token
  // per window, app-instance-scoped like the positive cache.
  const touchThrottle = createTtlCache<true>(TOUCH_THROTTLE_MAX_ENTRIES);
  const allowedOrigin = resolveAllowedOrigin(deps.auth.publicBaseUrl);

  return async (c, next) => {
    const startedAt = Date.now();

    // Bearer is accepted on `/api/*` EXCEPT `/api/auth/*` (login, logout,
    // the session probe, revoke-all and token mint/list/revoke stay
    // cookie-only: a stolen API token must never mint tokens or sign its
    // owner out). Where not accepted, the header is IGNORED (falls through
    // to the cookie path), never honored.
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

      // A token binds no installation: the audit world starts as the owner's,
      // and behind the repo gate the resolver names the repo's.
      const ownScope = { ownerUserId: principal.reviewerId };
      stampAuditScope(c, ownScope);
      c.set("session", principal);
      await next();
      return;
    }

    // No cookie, an unknown session and an expired one all answer 401
    // `signed-out`, with no GitHub call and no repo-existence hint, so a
    // browser tells a session that is gone from one GitHub refused.
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie === undefined) {
      stampAccess(c, "401", {});
      throw new Unauthorized(ApiErrorCodes.SIGNED_OUT);
    }
    const sessionTokenHash = sha256Hex(cookie);
    const resolved = await createSessionAuth(deps.handle).findSession(
      sessionTokenHash,
    );
    if (resolved === undefined) {
      stampAccess(c, "401", {});
      throw new Unauthorized(ApiErrorCodes.SIGNED_OUT);
    }
    // `findSession` does not filter on expiry, so it is enforced here.
    // `expires_at` tracks the refresh token's lifetime: past it there is no
    // recovery, so the row burns and the reviewer logs in again. An expired
    // access token is the repo gate's refresh path instead.
    if (resolved.session.expiresAt.getTime() <= startedAt) {
      await createSessionAuth(deps.handle).deleteSession(sessionTokenHash);
      stampAccess(c, "401", { reviewerId: resolved.session.reviewerId });
      throw new Unauthorized(ApiErrorCodes.SIGNED_OUT);
    }

    // No credential holds an installation: the audit world starts as the
    // owner's, and behind the repo gate the resolver names the repo's.
    const ownScope = { ownerUserId: resolved.session.reviewerId };
    stampAuditScope(c, ownScope);
    c.set("session", derivePrincipalFromSession(resolved));
    requireSameOrigin(c, allowedOrigin, resolved.session.reviewerId);
    await next();
    return;
  };
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
