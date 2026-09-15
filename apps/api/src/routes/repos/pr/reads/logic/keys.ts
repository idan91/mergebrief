// Pure key/body builders for the reads ops.
import type { RepoId } from "persistence";

/** Per-session diff-cache key; the session hash scopes it to one viewer. */
export function buildDiffCacheKey(input: {
  readonly sessionTokenHash: string;
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly base: string;
  readonly head: string;
}): string {
  return `${input.sessionTokenHash}:${String(input.repoId)}:${input.prNumber}:${input.base}:${input.head}`;
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

/** Per-session open-PR list key: one list serves every PR of the repo. */
export function buildOpenPullsCacheKey(input: {
  readonly sessionTokenHash: string;
  readonly repoId: RepoId;
}): string {
  return `${input.sessionTokenHash}:${String(input.repoId)}`;
}
