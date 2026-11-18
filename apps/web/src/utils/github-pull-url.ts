/** The pull request's page on GitHub; absent while its repository name is unknown. */
export function buildGithubPullUrl(
  repoSlug: string | undefined,
  prNumber: number,
): string | undefined {
  if (repoSlug === undefined) {
    return undefined;
  }
  return `https://github.com/${repoSlug}/pull/${String(prNumber)}`;
}
