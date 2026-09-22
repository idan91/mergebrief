// The wire item from one store row: ids stringified, dates as ISO strings,
// the stack snapshot reduced to a position, the generation slice as the PR
// meta reports it.
import { PrStackSchema } from "brief-core";
import type { InboxItem, InboxStackView } from "contract";
import type { GenerationRow, InboxRow } from "persistence";
import { buildGenerationSummary } from "../../pr-view";

/** A linear chain has a position; a fork has none worth a number. */
export function shapeStack(snapshot: unknown): InboxStackView | null {
  const parsed = PrStackSchema.safeParse(snapshot);
  if (!parsed.success || !("members" in parsed.data)) return null;
  return { index: parsed.data.index, size: parsed.data.members.length };
}

export function shapeInboxItem(
  row: InboxRow,
  latestGeneration: GenerationRow | undefined,
): InboxItem {
  const { pullRequest, latestBrief } = row;
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
    viewerIsAuthor: row.viewerIsAuthor,
    reviewState: row.reviewState,
    behind: row.behind,
    unreachable: pullRequest.githubUnreachableAt !== null,
    generation: buildGenerationSummary(latestGeneration, undefined),
    latestBriefAt: latestBrief?.createdAt.toISOString() ?? null,
    githubUpdatedAt: pullRequest.githubUpdatedAt?.toISOString() ?? null,
    stack: latestBrief === undefined ? null : shapeStack(latestBrief.stack),
  };
}
