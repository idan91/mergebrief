const SHORT_SHA_LENGTH = 7;

/** A commit sha as the page shows it: its first seven characters. */
export function getShortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}
