import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { commitShaSchema } from "../../../wire-bounds";
import { parseOwnerAndName } from "../../utils";
import { DIFF_FETCH_DEADLINE_MS, SPAN_DIFF_CACHE_LIMITS } from "./consts";
import { buildDiffCacheKey } from "./logic/keys";
import { measureHeldBytes } from "./logic/held-bytes";
import type { DiffQuery } from "./schemas";
import type { DiffFailure, ReadDiffDeps } from "./types";

/**
 * The LIVE diff for the requested `base...head` span, never the whole PR,
 * read on the viewer's binding by the gate's verified slug and cached per
 * session, NEVER persisted. The read stops attempting at its deadline, and a
 * body short of its declared length is refused. Behind an operator pass the
 * binding falls back only when both refs are full SHAs recorded for the
 * granted PR.
 */
export async function readDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  query: DiffQuery,
): Promise<Result<string, DiffFailure>> {
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

  const pinned = isCommitPinnedSpan(query);
  cacheDiff(
    deps,
    access.session.sessionTokenHash,
    cacheKey,
    diff.value,
    pinned,
  );
  return diff;
}

function isCommitPinnedSpan(query: DiffQuery): boolean {
  const baseIsSha = commitShaSchema.safeParse(query.base).success;
  return baseIsSha && commitShaSchema.safeParse(query.head).success;
}

/** A diff past the small cache's entry cap goes to the large-diff cache, and
 * only when both refs are commit SHAs: a branch ref's diff moves on push,
 * and that cache outlives the debounce. */
function cacheDiff(
  deps: ReadDiffDeps,
  viewer: string,
  cacheKey: string,
  diff: string,
  commitPinned: boolean,
): void {
  const storedAt = Date.now();
  const bytes = measureHeldBytes(diff);
  if (bytes <= SPAN_DIFF_CACHE_LIMITS.maxEntryBytes) {
    deps.diffCache.set(cacheKey, diff, bytes, storedAt);
    return;
  }
  if (commitPinned) {
    deps.largeDiffCache.set(viewer, cacheKey, diff, bytes, storedAt);
  }
}
