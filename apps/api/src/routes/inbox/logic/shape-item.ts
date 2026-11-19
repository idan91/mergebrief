// The wire item from one store row: ids stringified, dates as ISO strings,
// the row's last stack reduced to a position for a closed row (an open row
// without a live entry has none, same as the brief header), the generation
// slice as the PR meta reports it.
import { PrStackSchema } from "brief-core/pr-stack";
import type { InboxItem, InboxStackView } from "contract";
import type { GenerationRow, InboxRow, RepoId } from "persistence";
import { PrStates, PullRequestSources } from "types/pull-requests";
import { buildGenerationSummary } from "../../pr-view";

/** A linear chain has a position; a fork has none worth a number. */
export function shapeStack(snapshot: unknown): InboxStackView | null {
  const parsed = PrStackSchema.safeParse(snapshot);
  if (!parsed.success || !("members" in parsed.data)) {
    return null;
  }
  return { index: parsed.data.index, size: parsed.data.members.length };
}

/** A url row is the viewer's own; an installation row needs the admin bit. */
export function resolveViewerCanDelete(
  row: InboxRow,
  adminRepoIds: ReadonlySet<RepoId>,
): boolean {
  if (row.pullRequest.source === PullRequestSources.URL) {
    return true;
  }
  return adminRepoIds.has(row.pullRequest.repoId);
}

export function shapeInboxItem(
  row: InboxRow,
  latestGeneration: GenerationRow | undefined,
  viewerCanDelete: boolean,
  liveStack?: InboxStackView | null,
): InboxItem {
  const { pullRequest, latestBrief } = row;
  const storedStack =
    pullRequest.state === PrStates.OPEN ? null : shapeStack(pullRequest.stack);
  return {
    repoId: String(pullRequest.repoId),
    repoSlug: pullRequest.repoSlug,
    prNumber: pullRequest.prNumber,
    title: pullRequest.title,
    state: pullRequest.state,
    draft: pullRequest.draft,
    source: pullRequest.source,
    installationId:
      pullRequest.installationId === null
        ? null
        : String(pullRequest.installationId),
    authorLogin: pullRequest.authorLogin,
    viewerIsAuthor: row.viewerIsAuthor,
    viewerCanDelete,
    reviewState: row.reviewState,
    behind: row.behind,
    unreachable: pullRequest.githubUnreachableAt !== null,
    generation: buildGenerationSummary(latestGeneration, undefined),
    latestBriefAt: latestBrief?.createdAt.toISOString() ?? null,
    githubUpdatedAt: pullRequest.githubUpdatedAt?.toISOString() ?? null,
    githubCreatedAt: pullRequest.githubCreatedAt?.toISOString() ?? null,
    stack: liveStack === undefined ? storedStack : liveStack,
  };
}
