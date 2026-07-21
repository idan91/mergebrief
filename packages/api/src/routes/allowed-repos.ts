// The viewer's allowed-repo set (ADR 0016 #5b): the installation∩user-access
// intersection from GitHub (`GET /user/installations/{id}/repositories`,
// VIEWER token), cached per (principal, installation) for the same 60s
// constant as the positive authz cache. Extracted from pulls.ts (BRIEF-17
// PR 3) so `/api/pulls` and `/api/repos` share ONE resolver instance and ONE
// cache — one GitHub fetch serves both endpoints inside the TTL, and there is
// exactly one fail-closed code path (a GitHub failure is a 401/502, NEVER a
// DB-only listing).
import {
  createUserOctokit,
  GitHubApiErrorCode,
  listInstallationRepositoriesForUser,
} from "github";
import type { Logger } from "logging";
import { decryptToken, sessionAuth, type RepoId } from "persistence";
import type { Result } from "types";
import { refreshSessionToken, type AuthRouteDeps, type ViewerPrincipal } from "./auth";
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

export interface AllowedRepoResolver {
  /**
   * Resolve the viewer's allowed set (cache → GitHub with refresh-once).
   * Failure carries the HTTP status the route must return: 401 (auth dead)
   * or 502 (GitHub upstream) — the caller NEVER falls back to the DB.
   */
  resolve(
    session: ViewerPrincipal,
    log: Logger,
  ): Promise<Result<AllowedRepos, { status: 401 | 502 }>>;
}

/**
 * Build the shared resolver. ONE instance per app (`createApp`) — the cache
 * identity is what makes `/api/pulls` and `/api/repos` share fetches.
 */
export function createAllowedRepoResolver(deps: AuthRouteDeps): AllowedRepoResolver {
  // POSITIVE results only (a failed fetch is never cached), 60s — the same
  // revocation-staleness budget as the per-repo positive cache.
  const cache = createTtlCache<ReadonlyMap<RepoId, string>>(ALLOWED_SET_CACHE_MAX_ENTRIES);

  return {
    async resolve(session, log) {
      // Key includes the installation: an org switch rebinds the session row
      // without rotating the cookie, and the pre-switch allowed set must
      // never serve the new tenant.
      const cacheKey = `${session.sessionTokenHash}:${String(session.installationId)}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return { ok: true, value: { allowed: cached, session } };
      }

      const decrypted = await decryptToken(
        deps.auth.keyProvider,
        session.keyRef,
        session.ghTokenCiphertext,
      );
      if (!decrypted.ok) {
        // Unreadable token burns the session — same posture as the repo gate.
        // (On the Bearer channel this delete is a no-op by hash namespace;
        // the api_token row stays for its owner to see and revoke.)
        await sessionAuth(deps.handle).deleteSession(session.sessionTokenHash);
        return { ok: false, error: { status: 401 } };
      }
      let currentSession = session;
      let accessToken = decrypted.value;
      let repos = await listInstallationRepositoriesForUser(
        createUserOctokit(accessToken),
        currentSession.installationId,
      );
      if (!repos.ok && repos.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
        // Expired ~8h access token → serialized refresh, retry ONCE.
        const refreshed = await refreshSessionToken(deps, currentSession, log);
        if (!refreshed.ok) {
          return { ok: false, error: { status: 401 } };
        }
        currentSession = refreshed.value.session;
        accessToken = refreshed.value.accessToken;
        repos = await listInstallationRepositoriesForUser(
          createUserOctokit(accessToken),
          currentSession.installationId,
        );
      }
      if (!repos.ok) {
        // Fail closed — a DB-only fallback would leak rows (ADR 0016 #5b).
        const status = repos.error.code === GitHubApiErrorCode.UNAUTHORIZED ? 401 : 502;
        return { ok: false, error: { status } };
      }
      cache.set(cacheKey, repos.value, Date.now() + AUTHZ_CACHE_TTL_MS);
      return { ok: true, value: { allowed: repos.value, session: currentSession } };
    },
  };
}
