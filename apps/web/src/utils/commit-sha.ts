const FULL_COMMIT_SHA = /^[\da-f]{40}$/;

/** A full 40-hex commit SHA: the one ref shape GitHub can never repoint. */
export function isFullCommitSha(ref: string): boolean {
  return FULL_COMMIT_SHA.test(ref);
}
