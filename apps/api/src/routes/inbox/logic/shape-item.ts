// The wire item from one store row: ids stringified, dates as ISO strings,
// the row's last stack reduced to a position for a closed row (an open row
// without a live entry has none, same as the brief header), the generation
// slice as the PR meta reports it.
import { PrStackSchema } from "brief-core/pr-stack";
import type { InboxItem, InboxStackView } from "contract";
import type { GenerationRow, InboxRow } from "persistence";
import { PrStates, PullRequestSources } from "types/pull-requests";
import { buildGenerationSummary } from "../../pr-view";
import type { InboxPageInput } from "../types";

/** A linear chain has a position; a fork has none worth a number. */
export function shapeStack(snapshot: unknown): InboxStackView | null {
  const parsed = PrStackSchema.safeParse(snapshot);
  if (!parsed.success || !("members" in parsed.data)) {
    return null;
  }
  return { index: parsed.data.index, size: parsed.data.members.length };
}

/** What the viewer may do to one row, as GitHub's walk answered. */
export interface RowPermissions {
  readonly viewerCanDelete: boolean;
  readonly viewerCanPush: boolean;
}

/**
 * A url row is the viewer's own to delete and never pushable: a held head is
 * an installation's. An installation row reads the walk's admin and push bits.
 */
export function resolveRowPermissions(
  row: InboxRow,
  granted: Pick<InboxPageInput, "adminRepoIds" | "pushRepoIds">,
): RowPermissions {
  if (row.pullRequest.source === PullRequestSources.URL) {
    return { viewerCanDelete: true, viewerCanPush: false };
  }
  const repoId = row.pullRequest.repoId;
  return {
    viewerCanDelete: granted.adminRepoIds.has(repoId),
    viewerCanPush: granted.pushRepoIds.has(repoId),
  };
}

export function shapeInboxItem(
  row: InboxRow,
  latestGeneration: GenerationRow | undefined,
  permissions: RowPermissions,
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
    viewerCanDelete: permissions.viewerCanDelete,
    viewerCanPush: permissions.viewerCanPush,
    generateEveryPush: pullRequest.generateEveryPushAt !== null,
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
