import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { parseOwnerAndName } from "../../utils";
import { DIFF_CACHE_MAX_ENTRY_BYTES, DIFF_CACHE_TTL_MS } from "./consts";
import { buildDiffCacheKey } from "./logic/keys";
import type { DiffQuery } from "./schemas";
import type { DiffFailure, ReadDiffDeps } from "./types";

/**
 * The LIVE diff for the requested `base...head` span, never the whole PR,
 * read on the viewer's binding by the gate's verified slug and cached per
 * session, NEVER persisted. An oversized diff is served but not cached.
 * Behind an operator pass the binding falls back only when both refs are
 * full SHAs recorded for the granted PR.
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
  const cached = deps.diffCache.get(cacheKey, now);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  const span = { base: query.base, head: query.head };
  const diff = await access.github.forRepo(repo).fetchCompareDiff(span);
  if (!diff.ok) {
    const error = diff.error;
    return { ok: false, error: { kind: FailureKinds.GITHUB_DENIED, error } };
  }

  if (diff.value.length <= DIFF_CACHE_MAX_ENTRY_BYTES) {
    deps.diffCache.set(cacheKey, diff.value, now + DIFF_CACHE_TTL_MS, now);
  }
  return diff;
}
