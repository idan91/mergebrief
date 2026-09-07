// Pure key/body builders for the reads ops.
import type { RepoId } from "persistence";

/** Per-session diff-cache key — the session hash scopes it to one viewer. */
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
 * the column (or null for older rows) — composed, never re-parsed.
 */
export function composeBriefContextBody(repoConfig: string | null): string {
  return `{"repoConfig":${repoConfig ?? "null"}}`;
}
