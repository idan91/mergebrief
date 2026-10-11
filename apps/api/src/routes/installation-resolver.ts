// Which installation a repository belongs to for this credential: no
// credential holds a current installation, so every request finds it from
// the repository it names among the installations the viewer can reach. The
// allowed set is the union of every reachable installation's
// installation∩user-access intersection, VIEWER token, N walks in parallel,
// cached 60 s per credential. ONE instance per app, so there is exactly one
// fail-closed path: a GitHub failure is a 401/502, NEVER a DB-only listing,
// and a repo in no reachable installation drops to the viewer's own URL rows.
import {
  CredentialFailureCodes,
  GitHubApiErrorCodes,
  type GitHubCallFailure,
  type InstallationRepository,
  type UserInstallation,
} from "github";
import type { Logger } from "logging";
import type { InstallationId, RepoId } from "persistence";
import { HttpStatuses, type Result } from "types";
import type { AccessibleInstallationsResolver } from "./auth/accessible-installations";
import type { ViewerPrincipal } from "./auth/session/types";
import { AUTHZ_CACHE_TTL_MS } from "../access/consts";
import type { RequestGitHub } from "../access/reviewer-binding";
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
 * The HTTP status the route must return: 401 (auth dead) or 502 (GitHub
 * upstream); the caller NEVER falls back to the DB.
 */
export interface ResolverFailure {
  readonly status:
    | typeof HttpStatuses.UNAUTHORIZED
    | typeof HttpStatuses.BAD_GATEWAY;
}

export type AllowedRepoResolution = Result<AllowedRepos, ResolverFailure>;

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

export type RepoWorldResolution = Result<ResolvedRepoWorld, ResolverFailure>;

export interface InstallationResolver {
  /** The installation holding `repoId`, or the owner world when none does. */
  resolveInstallationForRepo(
    request: RequestGitHub,
    repoId: RepoId,
    log: Logger,
  ): Promise<RepoWorldResolution>;
  /** Every repository the viewer reaches through an installation. */
  listAllowedRepos(
    request: RequestGitHub,
    log: Logger,
  ): Promise<AllowedRepoResolution>;
}

interface InstallationWalk {
  readonly installationId: InstallationId;
  readonly repos: Result<
    ReadonlyMap<RepoId, InstallationRepository>,
    GitHubCallFailure
  >;
}

/** GitHub refused this one installation to the viewer; the others still count. */
function isDeniedWalk(walk: InstallationWalk): boolean {
  return !walk.repos.ok && isGitHubDenial(walk.repos.error);
}

/** A dead token is re-login (the credential already burned an unreadable one). */
function resolveWalkFailureStatus(
  failure: GitHubCallFailure,
): ResolverFailure["status"] {
  const authDead =
    failure.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE ||
    failure.code === GitHubApiErrorCodes.UNAUTHORIZED;
  if (authDead) {
    return HttpStatuses.UNAUTHORIZED;
  }
  return HttpStatuses.BAD_GATEWAY;
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
 * One failed walk fails the whole set, so the walks after it are never
 * started: a dead token or a GitHub outage costs one batch, not every one.
 * A denied installation (suspended, SAML-gated) is left out instead, which
 * is less access, never more. Every walk rides the request's one binding, so
 * an expired token renews once and every later walk runs on the new one.
 */
async function walkInstallations(
  request: RequestGitHub,
  installations: readonly UserInstallation[],
  log: Logger,
): Promise<InstallationWalk[]> {
  const walks = await runInBatches(
    installations,
    WALK_CONCURRENCY,
    async ({ installationId }) => {
      const repos =
        await request.github.listInstallationRepositories(installationId);
      return { installationId, repos };
    },
    (walk) => !walk.repos.ok && !isDeniedWalk(walk),
  );
  for (const walk of walks) {
    if (!walk.repos.ok && isDeniedWalk(walk)) {
      log.warn("installation walk denied, left out of the reachable set", {
        installationId: String(walk.installationId),
        code: walk.repos.error.code,
      });
    }
  }
  return walks;
}

/**
 * Build the shared resolver. ONE instance per app; the cache identity is what
 * makes the list routes and the gate share walks.
 */
export function createInstallationResolver(
  installations: AccessibleInstallationsResolver,
): InstallationResolver {
  const cache = createTtlCache<CachedAllowed>(ALLOWED_SET_CACHE_MAX_ENTRIES);
  // One walk per credential at a time: a cold brief page fans out several
  // gated reads at once, and each would otherwise paginate the same listings.
  const inFlight = new Map<string, Promise<AllowedRepoResolution>>();

  async function fetchAllowedSet(
    request: RequestGitHub,
    cacheKey: string,
    log: Logger,
  ): Promise<AllowedRepoResolution> {
    const reachable = await installations.resolve(request);
    if (!reachable.ok) {
      const status =
        reachable.error.kind === "auth-dead"
          ? HttpStatuses.UNAUTHORIZED
          : HttpStatuses.BAD_GATEWAY;
      return { ok: false, error: { status } };
    }

    const walks = await walkInstallations(
      request,
      reachable.value.installations,
      log,
    );
    const failed = walks.find((walk) => !walk.repos.ok && !isDeniedWalk(walk));
    if (failed !== undefined && !failed.repos.ok) {
      const status = resolveWalkFailureStatus(failed.repos.error);
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
    cache.set(cacheKey, { allowed, expiresAt }, expiresAt);
    const session = request.credential.session();
    return { ok: true, value: { allowed, session, expiresAt } };
  }

  async function listAllowedRepos(
    request: RequestGitHub,
    log: Logger,
  ): Promise<AllowedRepoResolution> {
    const session = request.credential.session();
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
    const walk = fetchAllowedSet(request, cacheKey, log);
    inFlight.set(cacheKey, walk);
    try {
      return await walk;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  return {
    listAllowedRepos,

    async resolveInstallationForRepo(request, repoId, log) {
      const resolved = await listAllowedRepos(request, log);
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
