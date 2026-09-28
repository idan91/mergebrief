// Which installation a repository belongs to for this credential: no
// credential holds a current installation, so every request finds it from
// the repository it names among the installations the viewer can reach. The
// allowed set is the union of every reachable installation's
// installation∩user-access intersection, VIEWER token, N walks in parallel,
// cached 60 s per credential. ONE instance per app, so there is exactly one
// fail-closed path: a GitHub failure is a 401/502, NEVER a DB-only listing,
// and a repo in no reachable installation drops to the viewer's own URL rows.
import {
  createUserOctokit,
  GitHubApiErrorCodes,
  listInstallationRepositoriesForUser,
  type GitHubApiError,
  type InstallationRepository,
} from "github";
import type { Logger } from "logging";
import {
  createSessionAuth,
  type InstallationId,
  type RepoId,
} from "persistence";
import { HttpStatuses, type Result } from "types";
import type { AccessibleInstallationsResolver } from "./auth/accessible-installations";
import {
  createReviewerGitHubClient,
  type ReviewerTokenFailure,
} from "./auth/reviewer-github-client";
import type { AuthRouteDeps, ViewerPrincipal } from "./auth/session/types";
import { AUTHZ_CACHE_TTL_MS } from "./authz";
import { runInBatches } from "./batches";
import { isGitHubDenial } from "../shared-errors/failures";
import { createTtlCache } from "./ttl-cache";

/**
 * Cap on cached allowed sets (one per live principal). Session hashes are
 * never reused, so an unbounded map would grow for the process lifetime.
 */
const ALLOWED_SET_CACHE_MAX_ENTRIES = 5_000;
/**
 * Installations walked at once. Each walk paginates its listing on the
 * viewer's token, so an unbounded fan-out over many installations would
 * trip GitHub's secondary rate limit and fail the whole set.
 */
const WALK_CONCURRENCY = 3;

/** One repository the viewer may read through an installation. */
export interface AllowedRepo {
  readonly installationId: InstallationId;
  /** GitHub-verified `owner/name`. */
  readonly fullName: string;
  /**
   * The viewer's `permissions.admin` as the walk read it. A cached hint for
   * the list; a route that acts on it re-reads the repository fresh.
   */
  readonly viewerIsAdmin: boolean;
}

/** The resolved set plus the (possibly refreshed) principal it was read under. */
export interface AllowedRepos {
  readonly allowed: ReadonlyMap<RepoId, AllowedRepo>;
  readonly session: ViewerPrincipal;
  /** Epoch ms; never later than the reachable set this was derived from. */
  readonly expiresAt: number;
}

interface CachedAllowed {
  readonly allowed: ReadonlyMap<RepoId, AllowedRepo>;
  readonly expiresAt: number;
}

/**
 * Failure carries the HTTP status the route must return: 401 (auth dead) or
 * 502 (GitHub upstream); the caller NEVER falls back to the DB.
 */
export type AllowedRepoResolution = Result<
  AllowedRepos,
  { status: typeof HttpStatuses.UNAUTHORIZED | typeof HttpStatuses.BAD_GATEWAY }
>;

/** The world a repository lives in for this credential. */
export type RepoWorld =
  | { readonly kind: "installation"; readonly installationId: InstallationId }
  | { readonly kind: "owner" };

export interface ResolvedRepoWorld {
  readonly world: RepoWorld;
  readonly session: ViewerPrincipal;
  /** Epoch ms; a cache entry built on this world expires no later. */
  readonly expiresAt: number;
}

export type RepoWorldResolution = Result<
  ResolvedRepoWorld,
  { status: typeof HttpStatuses.UNAUTHORIZED | typeof HttpStatuses.BAD_GATEWAY }
>;

export interface InstallationResolver {
  /** The installation holding `repoId`, or the owner world when none does. */
  resolveInstallationForRepo(
    session: ViewerPrincipal,
    repoId: RepoId,
    log: Logger,
  ): Promise<RepoWorldResolution>;
  /** Every repository the viewer reaches through an installation. */
  listAllowedRepos(
    session: ViewerPrincipal,
    log: Logger,
  ): Promise<AllowedRepoResolution>;
}

interface InstallationWalk {
  readonly installationId: InstallationId;
  readonly repos: Result<unknown, GitHubApiError | ReviewerTokenFailure>;
}

/** GitHub refused this one installation to the viewer; the others still count. */
function isDeniedWalk(walk: InstallationWalk): boolean {
  if (walk.repos.ok || "kind" in walk.repos.error) return false;
  return isGitHubDenial(walk.repos.error);
}

function mergeAllowedRepos(
  walks: ReadonlyArray<{
    readonly installationId: InstallationId;
    readonly repos: ReadonlyMap<RepoId, InstallationRepository>;
  }>,
): ReadonlyMap<RepoId, AllowedRepo> {
  const allowed = new Map<RepoId, AllowedRepo>();
  for (const walk of walks) {
    for (const [repoId, repo] of walk.repos) {
      if (!allowed.has(repoId)) {
        allowed.set(repoId, {
          installationId: walk.installationId,
          fullName: repo.fullName,
          viewerIsAdmin: repo.viewerIsAdmin,
        });
      }
    }
  }
  return allowed;
}

/**
 * Build the shared resolver. ONE instance per app; the cache identity is what
 * makes the list routes and the gate share walks.
 */
export function createInstallationResolver(
  deps: AuthRouteDeps,
  installations: AccessibleInstallationsResolver,
): InstallationResolver {
  const cache = createTtlCache<CachedAllowed>(ALLOWED_SET_CACHE_MAX_ENTRIES);
  // One walk per credential at a time: a cold brief page fans out several
  // gated reads at once, and each would otherwise paginate the same listings.
  const inFlight = new Map<string, Promise<AllowedRepoResolution>>();

  async function fetchAllowedSet(
    session: ViewerPrincipal,
    log: Logger,
  ): Promise<AllowedRepoResolution> {
    const reachable = await installations.resolve(session, log);
    if (!reachable.ok) {
      const status =
        reachable.error.kind === "auth-dead"
          ? HttpStatuses.UNAUTHORIZED
          : HttpStatuses.BAD_GATEWAY;
      return { ok: false, error: { status } };
    }

    // One client for every walk: the request's single refresh is shared, so
    // an expired token rotates once and every walk re-runs on the new one.
    const client = createReviewerGitHubClient(
      deps,
      reachable.value.session,
      log,
    );
    // One failed walk fails the whole set, so the walks after it are never
    // started: a dead token or a GitHub outage costs one batch, not every one.
    // A denied installation (suspended, SAML-gated) is left out instead,
    // which is less access, never more.
    const walks = await runInBatches(
      reachable.value.installations,
      WALK_CONCURRENCY,
      async ({ installationId }) => {
        const repos = await client.run((accessToken) =>
          listInstallationRepositoriesForUser(
            createUserOctokit(accessToken),
            installationId,
          ),
        );
        return { installationId, repos };
      },
      (walk) => !walk.repos.ok && !isDeniedWalk(walk),
    );
    for (const walk of walks) {
      if (
        isDeniedWalk(walk) &&
        !walk.repos.ok &&
        !("kind" in walk.repos.error)
      ) {
        log.warn("installation walk denied, left out of the reachable set", {
          installationId: String(walk.installationId),
          code: walk.repos.error.code,
        });
      }
    }

    const failed = walks.find((walk) => !walk.repos.ok && !isDeniedWalk(walk));
    if (failed !== undefined && !failed.repos.ok) {
      if ("kind" in failed.repos.error) {
        // Unreadable token burns the session; same posture as the repo
        // gate. (On the Bearer channel this delete is a no-op by hash
        // namespace; the api_token row stays for its owner to see and
        // revoke.)
        await createSessionAuth(deps.handle).deleteSession(
          session.sessionTokenHash,
        );
        return { ok: false, error: { status: HttpStatuses.UNAUTHORIZED } };
      }
      const status =
        failed.repos.error.code === GitHubApiErrorCodes.UNAUTHORIZED
          ? HttpStatuses.UNAUTHORIZED
          : HttpStatuses.BAD_GATEWAY;
      return { ok: false, error: { status } };
    }

    const succeeded = walks.flatMap((walk) =>
      walk.repos.ok
        ? [{ installationId: walk.installationId, repos: walk.repos.value }]
        : [],
    );
    const allowed = mergeAllowedRepos(succeeded);
    // Capped to the reachable set's own expiry: the windows never stack.
    const expiresAt = Math.min(
      Date.now() + AUTHZ_CACHE_TTL_MS,
      reachable.value.expiresAt,
    );
    cache.set(session.sessionTokenHash, { allowed, expiresAt }, expiresAt);
    return {
      ok: true,
      value: { allowed, session: client.session(), expiresAt },
    };
  }

  async function listAllowedRepos(
    session: ViewerPrincipal,
    log: Logger,
  ): Promise<AllowedRepoResolution> {
    const cacheKey = session.sessionTokenHash;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return {
        ok: true,
        value: {
          allowed: cached.allowed,
          session,
          expiresAt: cached.expiresAt,
        },
      };
    }

    const pending = inFlight.get(cacheKey);
    if (pending !== undefined) {
      return pending;
    }
    const walk = fetchAllowedSet(session, log);
    inFlight.set(cacheKey, walk);
    try {
      return await walk;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  return {
    listAllowedRepos,

    async resolveInstallationForRepo(session, repoId, log) {
      const resolved = await listAllowedRepos(session, log);
      if (!resolved.ok) {
        return resolved;
      }

      const entry = resolved.value.allowed.get(repoId);
      const world: RepoWorld =
        entry === undefined
          ? { kind: "owner" }
          : { kind: "installation", installationId: entry.installationId };
      return {
        ok: true,
        value: {
          world,
          session: resolved.value.session,
          expiresAt: resolved.value.expiresAt,
        },
      };
    },
  };
}
