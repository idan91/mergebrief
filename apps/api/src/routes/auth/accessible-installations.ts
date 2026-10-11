// The installations the viewer can reach, read from GitHub with the viewer's
// own token, never taken from the caller. One resolver per app instance:
// positive results are cached 60 s per credential, one walk at a time per
// credential, and a failure is never cached.
import {
  CredentialFailureCodes,
  GitHubApiErrorCodes,
  type UserInstallation,
} from "github";
import type { Result } from "types/utils";
import type { RequestGitHub } from "../../access/reviewer-binding";
import type { ViewerPrincipal } from "./session/types";
import { AUTHZ_CACHE_TTL_MS } from "../../access/consts";
import { createTtlCache } from "../ttl-cache";

/** Bounded like the other per-credential caches: hashes are never reused. */
const INSTALLATIONS_CACHE_MAX_ENTRIES = 5_000;

/** The resolved set plus the (possibly refreshed) session it was read under. */
export interface AccessibleSet {
  readonly installations: readonly UserInstallation[];
  readonly session: ViewerPrincipal;
  /**
   * Epoch ms after which this set is no longer served. A value derived from
   * it must expire no later, or a revoked installation outlives one window.
   */
  readonly expiresAt: number;
}

interface CachedSet {
  readonly installations: readonly UserInstallation[];
  readonly expiresAt: number;
}

/** Semantic failure kinds; the caller's handler owns the wire mapping. */
export type AccessibleSetFailure =
  | { readonly kind: "auth-dead" }
  | { readonly kind: "upstream-failed" };

export type AccessibleSetResolution = Result<
  AccessibleSet,
  AccessibleSetFailure
>;

export interface AccessibleInstallationsResolver {
  /** Resolve the viewer's reachable set (cache, then GitHub on the request's binding). */
  resolve(request: RequestGitHub): Promise<AccessibleSetResolution>;
}

/**
 * `auth-dead` = re-login territory (an unreadable stored token, which the
 * credential answers by burning the session, or a still-unauthorized GitHub
 * answer); `upstream-failed` = GitHub upstream error.
 */
async function fetchAccessibleInstallations(
  request: RequestGitHub,
): Promise<AccessibleSetResolution> {
  const listed = await request.github.listUserInstallations();
  if (!listed.ok) {
    const code = listed.error.code;
    const authDead =
      code === CredentialFailureCodes.CREDENTIAL_UNREADABLE ||
      code === GitHubApiErrorCodes.UNAUTHORIZED;
    if (authDead) {
      return { ok: false, error: { kind: "auth-dead" } };
    }
    return { ok: false, error: { kind: "upstream-failed" } };
  }
  return {
    ok: true,
    value: {
      installations: listed.value,
      session: request.credential.session(),
      expiresAt: Date.now() + AUTHZ_CACHE_TTL_MS,
    },
  };
}

/** Build the shared resolver. ONE instance per app; the cache is its identity. */
export function createAccessibleInstallationsResolver(): AccessibleInstallationsResolver {
  const cache = createTtlCache<CachedSet>(INSTALLATIONS_CACHE_MAX_ENTRIES);
  const inFlight = new Map<string, Promise<AccessibleSetResolution>>();

  async function walk(
    request: RequestGitHub,
    cacheKey: string,
  ): Promise<AccessibleSetResolution> {
    const resolved = await fetchAccessibleInstallations(request);
    if (resolved.ok) {
      const { installations, expiresAt } = resolved.value;
      cache.set(cacheKey, { installations, expiresAt }, expiresAt);
    }
    return resolved;
  }

  return {
    async resolve(request) {
      const session = request.credential.session();
      const cacheKey = session.sessionTokenHash;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return {
          ok: true,
          value: {
            installations: cached.installations,
            session,
            expiresAt: cached.expiresAt,
          },
        };
      }

      const pending = inFlight.get(cacheKey);
      if (pending !== undefined) {
        return pending;
      }
      const started = walk(request, cacheKey);
      inFlight.set(cacheKey, started);
      try {
        return await started;
      } finally {
        inFlight.delete(cacheKey);
      }
    },
  };
}
