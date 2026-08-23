/**
 * Split a GitHub-verified `owner/repo` full name. Defensive only — a
 * malformed shape must never reach a GitHub call. Shared by every consumer
 * of the gate's verified slug and the mutating routes' fresh re-resolve.
 */
export function splitRepoSlug(
  slug: string,
): { owner: string; repo: string } | undefined {
  const parts = slug.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    owner === "" ||
    repo === ""
  ) {
    return undefined;
  }
  return { owner, repo };
}
