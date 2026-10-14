// The PR meta's row-derived view, and the generation slice the Inbox shares
// with it: one `pull_request` row joined with its CURRENT-SPAN derivation.
// The current head is the newest brief-kind `generation` projection's head
// (written at ingest, so it exists from the first webhook, before any
// artifact); `briefAvailable` is true only when the latest brief artifact IS
// for that head (render trigger = artifact EXISTS, status is display-only).
// `baseSha` prefers the brief row and falls back to the base SHA persisted
// at ingest.
import type { GenerationSummaryView, PullMetaView, WaitReason } from "contract";
import type { BriefSpanRow, GenerationRow, PullRequestRow } from "persistence";
import type { Mutable } from "types/utils";

/** The row-derived part of the PR meta; the read adds the rest. */
export type PrView = Omit<
  PullMetaView,
  "comparisons" | "appInstalled" | "draftPolicy" | "revisions"
>;

/**
 * The `viewerIsAuthor` truth function. True ONLY when both logins are present
 * (non-null, non-empty) and equal, so a null/missing author login and a
 * null/missing viewer login both yield false, never a spurious `null === null`.
 */
export function deriveViewerIsAuthor(
  viewerLogin: string | null,
  authorLogin: string | null,
): boolean {
  return Boolean(authorLogin) && authorLogin === viewerLogin;
}

export function buildGenerationSummary(
  latestGeneration: GenerationRow | undefined,
  waitReason: WaitReason | undefined,
): GenerationSummaryView | null {
  if (latestGeneration === undefined) {
    return null;
  }
  const summary: Mutable<GenerationSummaryView> = {
    status: latestGeneration.status,
    phase: latestGeneration.phase,
    attempts: latestGeneration.attempts,
    errorCode: latestGeneration.errorCode,
    errorParams: latestGeneration.errorParams,
    updatedAt: latestGeneration.updatedAt.toISOString(),
  };

  if (waitReason !== undefined) {
    summary.waitReason = waitReason;
  }
  return summary;
}

/**
 * Assemble the view. `verifiedSlug` is the GitHub-verified `owner/name` (from
 * the access check or the allowed-set intersection) and wins over the row's
 * stored `repo_slug`, which can go stale across renames.
 */
export function buildPrView(
  row: PullRequestRow,
  latestBrief: BriefSpanRow | undefined,
  latestGeneration: GenerationRow | undefined,
  verifiedSlug: string | undefined,
  viewerLogin: string | null,
  viewerCanPush: boolean,
  waitReason?: WaitReason,
): PrView {
  const headSha = latestGeneration?.headSha ?? latestBrief?.headSha ?? null;
  const briefAvailable =
    latestBrief !== undefined && latestBrief.headSha === headSha;
  const viewerIsAuthor = deriveViewerIsAuthor(viewerLogin, row.authorLogin);
  const behind =
    row.githubHeadSha !== null &&
    latestBrief !== undefined &&
    row.githubHeadSha !== latestBrief.headSha;
  return {
    repoId: String(row.repoId),
    repoSlug: verifiedSlug ?? row.repoSlug,
    prNumber: row.prNumber,
    title: row.title,
    state: row.state,
    baseSha: briefAvailable ? latestBrief.baseSha : row.baseSha,
    headSha,
    briefAvailable,
    draft: row.draft,
    authorLogin: row.authorLogin,
    viewerIsAuthor,
    viewerCanResolve: viewerCanPush || viewerIsAuthor,
    generation: buildGenerationSummary(latestGeneration, waitReason),
    updatedAt: row.updatedAt.toISOString(),
    behind,
  };
}
