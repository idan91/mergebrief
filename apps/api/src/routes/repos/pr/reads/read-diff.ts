import type { RepositoryRef } from "github";
import type { Logger } from "logging";
import type { PullRequestAccess } from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { parseOwnerAndName } from "../../utils";
import { DIFF_FETCH_DEADLINE_MS } from "./consts";
import { buildDiffCacheKey } from "./logic/keys";
import { measureHeldBytes } from "./logic/held-bytes";
import type { DiffQuery } from "./schemas";
import {
  DiffLifetimes,
  type DiffLifetime,
  type DiffRead,
  type ReadDiffDeps,
} from "./types";
import { commitShaSchema } from "../../../wire-bounds";

/**
 * The LIVE diff for the requested `base...head` span, never the whole PR,
 * read on the viewer's binding by the gate's verified slug and cached per
 * session, NEVER persisted. Concurrent reads of one cache key share one
 * GitHub call. The read stops attempting at its deadline, and a body short of
 * its declared length is refused. Behind an operator pass the binding falls
 * back only when both refs are full SHAs recorded for the granted PR.
 */
export async function readDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  query: DiffQuery,
): Promise<DiffRead> {
  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return { ok: false, error: { kind: "not-found" } };
  }

  const cacheKey = buildDiffCacheKey({
    sessionTokenHash: access.session.sessionTokenHash,
    repoId: access.repoId,
    prNumber: access.prNumber,
    base: query.base,
    head: query.head,
  });
  const now = Date.now();
  const cached =
    deps.diffCache.get(cacheKey, now) ?? deps.largeDiffCache.get(cacheKey, now);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }
  const inFlight = deps.diffFetches.get(cacheKey);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const fetching = fetchDiff(deps, access, repo, query, cacheKey).finally(
    () => {
      deps.diffFetches.delete(cacheKey);
    },
  );
  deps.diffFetches.set(cacheKey, fetching);
  return fetching;
}

/**
 * Reads the span's diff so the page's own read lands on the cache. Never
 * rejects: a failure caches nothing and reaches no caller.
 */
export async function warmDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  query: DiffQuery,
  log: Logger,
): Promise<void> {
  try {
    const read = await readDiff(deps, access, query);
    if (!read.ok) {
      log.debug("span diff warm refused", { failure: read.error.kind });
    }
  } catch (error) {
    log.debug("span diff warm failed", { err: error });
  }
}

async function fetchDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  repo: RepositoryRef,
  query: DiffQuery,
  cacheKey: string,
): Promise<DiffRead> {
  const span = {
    base: query.base,
    head: query.head,
    deadlineMs: DIFF_FETCH_DEADLINE_MS,
  };
  const diff = await access.github.forRepo(repo).fetchCheckedCompareDiff(span);
  if (!diff.ok) {
    const error = diff.error;
    return { ok: false, error: { kind: FailureKinds.GITHUB_DENIED, error } };
  }

  const lifetime = resolveDiffLifetime(query);
  const viewer = access.session.sessionTokenHash;
  cacheDiff(deps, viewer, cacheKey, diff.value, lifetime);
  return diff;
}

/** Both refs full SHAs: GitHub can never answer that span differently. */
function resolveDiffLifetime(query: DiffQuery): DiffLifetime {
  const pinned =
    commitShaSchema.safeParse(query.base).success &&
    commitShaSchema.safeParse(query.head).success;
  return pinned ? DiffLifetimes.SHA_PINNED : DiffLifetimes.LIVE;
}

/** A diff the small cache refuses goes to the large-diff cache, and only
 * when both refs are commit SHAs: a branch ref's diff moves on push, and that
 * cache outlives the debounce. */
function cacheDiff(
  deps: ReadDiffDeps,
  viewer: string,
  cacheKey: string,
  diff: string,
  lifetime: DiffLifetime,
): void {
  const storedAt = Date.now();
  const bytes = measureHeldBytes(diff);
  const heldBySpanCache = deps.diffCache.set(
    cacheKey,
    diff,
    bytes,
    storedAt,
    lifetime,
  );
  if (heldBySpanCache) {
    return;
  }
  if (lifetime === DiffLifetimes.SHA_PINNED) {
    deps.largeDiffCache.set(viewer, cacheKey, diff, bytes, storedAt);
  }
}
