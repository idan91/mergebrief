// The PR meta's row-derived view, and the generation slice the Inbox shares
// with it: one `pull_request` row joined with its CURRENT-SPAN derivation.
// The current head is the newest brief-kind `generation` projection's head
// (written at ingest, before any artifact); `headBriefStored` is true only
// when the latest brief artifact IS for that head, on any base. `baseSha`
// prefers that brief's base, else the base persisted at ingest. The read
// adds `briefAvailable`, which needs every stored brief. The render trigger
// is an artifact that exists; the status is display-only.
import type {
  GenerationPartsView,
  GenerationSummaryView,
  PullMetaView,
  WaitReason,
} from "contract";
import type { BriefSpanRow, GenerationRow, PullRequestRow } from "persistence";
import type { Mutable } from "types/utils";

/** What the PR meta says about the run holding the row. */
export interface MetaRunProgress {
  readonly startedAt: Date;
  /** Present once a multi-call run's grouping planned its detail calls. */
  readonly parts?: GenerationPartsView;
}

/** The row-derived part of the PR meta; the read adds the rest. */
export type PrView = Omit<
  PullMetaView,
  | "comparisons"
  | "appInstalled"
  | "draftPolicy"
  | "revisions"
  | "briefAvailable"
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
  progress?: MetaRunProgress,
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
  if (progress !== undefined) {
    summary.startedAt = progress.startedAt.toISOString();
    if (progress.parts !== undefined) {
      summary.parts = progress.parts;
    }
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
  progress?: MetaRunProgress,
): PrView {
  const headSha = latestGeneration?.headSha ?? latestBrief?.headSha ?? null;
  const headBriefStored =
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
    baseSha: headBriefStored ? latestBrief.baseSha : row.baseSha,
    headSha,
    headBriefStored,
    draft: row.draft,
    authorLogin: row.authorLogin,
    viewerIsAuthor,
    viewerCanResolve: viewerCanPush || viewerIsAuthor,
    viewerCanPush,
    generation: buildGenerationSummary(latestGeneration, waitReason, progress),
    updatedAt: row.updatedAt.toISOString(),
    behind,
  };
}
