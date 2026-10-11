// The PR view the list and PR-meta endpoints share: one `pull_request` row
// joined with its CURRENT-SPAN derivation. The current head is the newest
// brief-kind `generation` projection's head (written at ingest, so it exists
// from the first webhook, before any artifact); `briefAvailable` is true only
// when the latest brief artifact IS for that head (render trigger = artifact
// EXISTS, status is display-only). `baseSha` prefers the brief row and falls
// back to the base SHA persisted at ingest.
import type { WaitReason } from "contract";
import type { BriefSpanRow, GenerationRow, PullRequestRow } from "persistence";
import type {
  GenerationFailureCode,
  GenerationFailureParams,
  GenerationPhase,
  GenerationStatus,
} from "types/generations";
import type { PrState } from "types/pull-requests";
import type { Mutable } from "types/utils";

/** The poll-relevant slice of a `generation` projection row. */
export interface GenerationSummaryView {
  readonly status: GenerationStatus;
  readonly phase: GenerationPhase | null;
  readonly attempts: number;
  /**
   * The stored failure vocabulary code: MODELED DATA inside a 200, not a
   * wire `ApiErrorCode`. Consumers render `generationError.<code>` from the
   * catalog; a code they do not know degrades to the generic failed line.
   */
  readonly errorCode: GenerationFailureCode | null;
  /** Interpolation params for the code's template; `detail` pre-sanitized. */
  readonly errorParams: GenerationFailureParams | null;
  readonly updatedAt: string;
  /**
   * Present only on the PR meta, and only while the generation is pending
   * with a queued job no worker holds. The list endpoints never fill it.
   */
  readonly waitReason?: WaitReason;
}

export interface PrView {
  /** Stringified: GitHub repo ids exceed JSON's safe-integer comfort zone. */
  readonly repoId: string;
  readonly repoSlug: string | null;
  readonly prNumber: number;
  readonly title: string | null;
  readonly state: PrState;
  /**
   * The span's lower bound: the brief's base when one exists, else the base
   * SHA persisted at ingest. Null only for rows ingested before `base_sha`
   * existed.
   */
  readonly baseSha: string | null;
  /** The current push's head; null only when nothing was ever projected. */
  readonly headSha: string | null;
  readonly briefAvailable: boolean;
  /** GitHub draft state: the FE derives own-draft author affordances. */
  readonly draft: boolean;
  /** The PR author's GitHub login; null when GitHub sent no user. */
  readonly authorLogin: string | null;
  /**
   * Whether the requesting viewer is this PR's author, computed PER REQUEST
   * server-side by comparing the session's reviewer login to the row's stored
   * `author_login`. False for any null/missing author or viewer login.
   */
  readonly viewerIsAuthor: boolean;
  /**
   * Whether the requesting viewer may resolve/unresolve review threads on this
   * PR: GitHub push permission OR PR authorship, GitHub's own rule for
   * `resolveReviewThread`. Affordance only, with GitHub's mutation-time
   * enforcement as the truth. On the LIST path the per-repo capability is
   * unknown (no per-repo access check runs there), so rows fall back to
   * authorship-only: the brief page must read this from PR meta, not the list.
   */
  readonly viewerCanResolve: boolean;
  readonly generation: GenerationSummaryView | null;
  readonly updatedAt: string;
  /** GitHub reports a head the latest brief does not cover. */
  readonly behind: boolean;
}

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
