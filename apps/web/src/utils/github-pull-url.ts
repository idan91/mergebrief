/** The pull request's page on GitHub; null while its repository name is unknown. */
export function buildGithubPullUrl(
  repoSlug: string | null,
  prNumber: number,
): string | null {
  if (repoSlug === null) {
    return null;
  }
  return `https://github.com/${repoSlug}/pull/${String(prNumber)}`;
}
