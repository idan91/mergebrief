// Pure key/body builders for the reads ops.
import type { PrSpanRefs } from "brief-core/pr-span";
import type { RepoId } from "persistence";

/**
 * Per-session diff-cache key; the session hash scopes it to one viewer. A
 * revision span adds the bases its marks row stores, so a span read on
 * other refs, or a compare of the same pair, never answers from it.
 */
export function buildDiffCacheKey(input: {
  readonly sessionTokenHash: string;
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly base: string;
  readonly head: string;
  readonly refs?: PrSpanRefs;
}): string {
  const pairKey = `${input.sessionTokenHash}:${String(input.repoId)}:${input.prNumber}:${input.base}:${input.head}`;
  if (input.refs === undefined) {
    return pairKey;
  }
  return `${pairKey}:span:${input.refs.prevBase}:${input.refs.newBase}`;
}

/**
 * The brief-context envelope. `repoConfig` is ALREADY validated JSON from
 * the column (or null for older rows), composed, never re-parsed.
 */
export function composeBriefContextBody(repoConfig: string | null): string {
  return `{"repoConfig":${repoConfig ?? "null"}}`;
}

/**
 * Per-session file-blob cache key. `path` may carry a `:`, but it is the last
 * field and the three before it are fixed-format (hex hash, digits, 40-hex
 * sha), so no two (ref, path) pairs can collide on one key.
 */
export function buildFileBlobCacheKey(input: {
  readonly sessionTokenHash: string;
  readonly repoId: RepoId;
  readonly ref: string;
  readonly path: string;
}): string {
  return `${input.sessionTokenHash}:${String(input.repoId)}:${input.ref}:${input.path}`;
}
