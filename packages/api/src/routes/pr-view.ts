// The PR view the list and PR-meta endpoints share (BRIEF-19 PR 1.2): one
// `pull_request` row joined with its CURRENT-SPAN derivation. The current head
// is the newest brief-kind `generation` projection's head (the projection row
// is written at ingest, so it exists from the first webhook — before any
// artifact); `briefAvailable` is true only when the latest brief artifact IS
// for that head (render trigger = artifact EXISTS, ADR 0006 #10 — status is
// display-only). `baseSha` comes from the brief row, so it is null exactly
// while the current span has no brief yet (the FE's "span unknown" signal).
import type {
  BriefSpanRow,
  GenerationPhase,
  GenerationRow,
  GenerationStatus,
  PrState,
  PullRequestRow,
} from "persistence";

/** The poll-relevant slice of a `generation` projection row. */
export interface GenerationSummaryView {
  readonly status: GenerationStatus;
  readonly phase: GenerationPhase | null;
  readonly attempts: number;
  /** Already sanitized at write time (`sanitizeGenerationError`). */
  readonly error: string | null;
  readonly updatedAt: string;
}

export interface PrView {
  /** Stringified — GitHub repo ids exceed JSON's safe-integer comfort zone. */
  readonly repoId: string;
  readonly repoSlug: string | null;
  readonly prNumber: number;
  readonly title: string | null;
  readonly state: PrState;
  /** The current span's brief base; null while the span has no brief. */
  readonly baseSha: string | null;
  /** The current push's head; null only when nothing was ever projected. */
  readonly headSha: string | null;
  readonly briefAvailable: boolean;
  readonly generation: GenerationSummaryView | null;
  readonly updatedAt: string;
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
): PrView {
  const headSha = latestGeneration?.headSha ?? latestBrief?.headSha ?? null;
  const briefAvailable = latestBrief !== undefined && latestBrief.headSha === headSha;
  return {
    repoId: String(row.repoId),
    repoSlug: verifiedSlug ?? row.repoSlug,
    prNumber: row.prNumber,
    title: row.title,
    state: row.state,
    baseSha: briefAvailable ? latestBrief.baseSha : null,
    headSha,
    briefAvailable,
    generation:
      latestGeneration === undefined
        ? null
        : {
            status: latestGeneration.status,
            phase: latestGeneration.phase,
            attempts: latestGeneration.attempts,
            error: latestGeneration.error,
            updatedAt: latestGeneration.updatedAt.toISOString(),
          },
    updatedAt: row.updatedAt.toISOString(),
  };
}
