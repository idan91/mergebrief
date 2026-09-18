// The viewer's allowed-repo set: the installation∩user-access intersection from
// GitHub (`GET /user/installations/{id}/repositories`, VIEWER token), cached
// per (principal, installation) for the same 60s constant as the positive authz
// cache. `/api/pulls` and `/api/repos` share ONE resolver instance and ONE
// cache, so there is exactly one fail-closed code path (a GitHub failure is a
// 401/502, NEVER a DB-only listing).
import {
  createUserOctokit,
  GitHubApiErrorCodes,
  listInstallationRepositoriesForUser,
} from "github";
import type { Logger } from "logging";
import {
  createSessionAuth,
  type InstallationId,
  type RepoId,
} from "persistence";
import type { Result } from "types/utils";
import type { AuthRouteDeps, ViewerPrincipal } from "./auth/session/types";
import { createReviewerGitHubClient } from "./auth/reviewer-github-client";
import { AUTHZ_CACHE_TTL_MS } from "./authz";
import { createTtlCache } from "./ttl-cache";

/**
 * Cap on cached allowed sets (one per live principal). Session hashes are
 * never reused, so an unbounded map would grow for the process lifetime.
 */
const ALLOWED_SET_CACHE_MAX_ENTRIES = 5_000;

/** The resolved set plus the (possibly refreshed) principal it was read under. */
export interface AllowedRepos {
  /** repoId → GitHub-verified `owner/name`. */
  readonly allowed: ReadonlyMap<RepoId, string>;
  readonly session: ViewerPrincipal;
}

/**
 * Failure carries the HTTP status the route must return: 401 (auth dead) or
 * 502 (GitHub upstream); the caller NEVER falls back to the DB.
 */
export type AllowedRepoResolution = Result<AllowedRepos, { status: 401 | 502 }>;

export interface AllowedRepoResolver {
  /** Resolve the viewer's allowed set (cache → GitHub with refresh-once). */
  resolve(
    session: ViewerPrincipal,
    log: Logger,
  ): Promise<AllowedRepoResolution>;
}

/**
 * Build the shared resolver. ONE instance per app; the cache identity is what
 * makes `/api/pulls` and `/api/repos` share fetches.
 */
export function createAllowedRepoResolver(
  deps: AuthRouteDeps,
): AllowedRepoResolver {
  // POSITIVE results only (a failed fetch is never cached), 60s; the same
  // revocation-staleness budget as the per-repo positive cache.
  const cache = createTtlCache<ReadonlyMap<RepoId, string>>(
    ALLOWED_SET_CACHE_MAX_ENTRIES,
  );
  // One walk per key at a time: a cold brief page fans out several gated
  // reads at once, and each would otherwise paginate the same listing.
  const inFlight = new Map<string, Promise<AllowedRepoResolution>>();

  async function fetchAllowedSet(
    session: ViewerPrincipal,
    installationId: InstallationId,
    cacheKey: string,
    log: Logger,
  ): Promise<AllowedRepoResolution> {
    // The per-request client: lazy single decrypt, expired ~8h access token
    // → serialized refresh, retry ONCE. The installation is the one this
    // request authorized; a concurrent rebind must not swap it mid-call.
    const client = createReviewerGitHubClient(deps, session, log);
    const repos = await client.run((accessToken) =>
      listInstallationRepositoriesForUser(
        createUserOctokit(accessToken),
        installationId,
      ),
    );
    if (!repos.ok) {
      if ("kind" in repos.error) {
        // Unreadable token burns the session; same posture as the repo
        // gate. (On the Bearer channel this delete is a no-op by hash
        // namespace; the api_token row stays for its owner to see and
        // revoke.)
        await createSessionAuth(deps.handle).deleteSession(
          session.sessionTokenHash,
        );
        return { ok: false, error: { status: 401 } };
      }
      // Fail closed; a DB-only fallback would leak rows.
      const status =
        repos.error.code === GitHubApiErrorCodes.UNAUTHORIZED ? 401 : 502;
      return { ok: false, error: { status } };
    }
    cache.set(cacheKey, repos.value, Date.now() + AUTHZ_CACHE_TTL_MS);
    return {
      ok: true,
      value: { allowed: repos.value, session: client.session() },
    };
  }

  return {
    async resolve(session, log) {
      // Key includes the installation: an org switch rebinds the session row
      // without rotating the cookie, and the pre-switch allowed set must
      // never serve the new tenant.
      const { installationId } = session;
      if (installationId === null) {
        // No installation → the installation∩viewer intersection is empty.
        // Fail closed with no GitHub call rather than probing a non-tenant.
        return { ok: true, value: { allowed: new Map(), session } };
      }
      const cacheKey = `${session.sessionTokenHash}:${String(installationId)}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return { ok: true, value: { allowed: cached, session } };
      }

      const pending = inFlight.get(cacheKey);
      if (pending !== undefined) {
        return pending;
      }
      const walk = fetchAllowedSet(session, installationId, cacheKey, log);
      inFlight.set(cacheKey, walk);
      try {
        return await walk;
      } finally {
        inFlight.delete(cacheKey);
      }
    },
  };
}
