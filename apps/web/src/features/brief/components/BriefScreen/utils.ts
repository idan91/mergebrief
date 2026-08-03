// Closure-free BriefScreen logic (ADR 0037 decision 3): derivations extracted
// from the screen/hooks so they are unit-testable directly, without rendering.
import type {
  RiskEvidence,
  RiskEvidenceKind,
} from "@web/features/review/utils/state";
import type { CompareParam } from "../../comparison/compareState";
import type { ComparisonQuery } from "../../comparison/comparisonQuery";
import {
  buildChunkComparisonView,
  type ComparisonMarkFiles,
} from "../../comparison/comparison";
import type { ProgressTotals } from "../../utils/progress";
import type {
  BriefChunk,
  ComparisonAvailability,
  IntentCheck,
  RevisionNarrative,
  RevisionNarrativeArtifact,
  RevisionNarrativeSkipReason,
} from "../../types";
import type { PostDraftOutcome } from "./useOwnDraftFlow";

/** Typed placeholder for a plan slot that is absent — always `enabled: false`. */
export function disabledComparisonQuery<T>(slot: string): ComparisonQuery<T> {
  return {
    queryKey: ["comparison-plan-disabled", slot],
    queryFn: () => Promise.reject(new Error("comparison query disabled")),
  };
}

/**
 * Total contiguous marked runs across the brief's chunks — the comparison
 * overlay's jump-nav count. 0 without marks (overlay off or unavailable).
 */
export function countComparisonRuns(
  chunks: BriefChunk[],
  marks: ComparisonMarkFiles | null,
): number {
  if (marks === null) return 0;
  return chunks.reduce(
    (total, chunk) =>
      total + buildChunkComparisonView(chunk, marks).runs.length,
    0,
  );
}

/**
 * Per-group changed-since counts (BRIEF-102): DISTINCT member files with a
 * nonempty entry in the last-review marks. `undefined` without marks — no
 * checkpoint means no marker, distinct from a checkpoint with zero changes
 * ("unchanged since your last review"). Mechanical marks only, mirroring the
 * highlight rule (ADR 0024): narrative/Delta text never decides the count.
 */
export function groupSinceMarkers(
  groups: { id: string; chunks: { file: string }[] }[],
  marks: ComparisonMarkFiles | null,
): Map<string, number> | undefined {
  if (marks === null) return undefined;
  const changedFiles = new Set(
    marks.files
      .filter(
        (entry) => entry.addedRanges.length + entry.removedRanges.length > 0,
      )
      .map((entry) => entry.file),
  );
  return new Map(
    groups.map((group) => [
      group.id,
      new Set(
        group.chunks
          .map((chunk) => chunk.file)
          .filter((file) => changedFiles.has(file)),
      ).size,
    ]),
  );
}

/**
 * BRIEF-54 soft-gate line: count of precise stated-but-missing asks. Zero on
 * broad/none or a pre-feature Brief. Never feeds the gate's OPEN condition.
 */
export function countIntentGaps(intentCheck: IntentCheck | undefined): number {
  return intentCheck?.specificity === "precise"
    ? intentCheck.statedButMissing.length
    : 0;
}

/**
 * BRIEF-85 soft-gate line 2: count of precise intent TENSIONS — unacknowledged
 * deviations plus claimed-but-unachieved. Acknowledged deviations are excluded:
 * the description already owns that reversal. Precise-only and caller-gated
 * like `countIntentGaps`; never part of the gate's OPEN condition.
 */
export function countIntentTensions(
  intentCheck: IntentCheck | undefined,
): number {
  return intentCheck?.specificity === "precise"
    ? intentCheck.deviations.filter((item) => !item.acknowledged).length +
        intentCheck.claimedButUnachieved.length
    : 0;
}

/**
 * Which groups carry conversation threads — the TocBar's markers. Undefined
 * when there is no conversation (or none of it landed on a chunk).
 */
export function conversationGroupIds(
  conversationByChunk: ReadonlyMap<string, unknown> | undefined,
  groups: readonly { id: string; chunks: readonly { id: string }[] }[],
): Set<string> | undefined {
  if (conversationByChunk === undefined || conversationByChunk.size === 0)
    return undefined;
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.chunks.some((chunk) => conversationByChunk.has(chunk.id))) {
      ids.add(group.id);
    }
  }
  return ids;
}

/** Index where each group's first chunk lands in the flat reading order. */
export function groupStartIndexes(
  groups: readonly { chunks: readonly unknown[] }[],
): number[] {
  let offset = 0;
  const boundaries: number[] = [];
  for (const group of groups) {
    boundaries.push(offset);
    offset += group.chunks.length;
  }
  return boundaries;
}

export interface DeriveBriefProgressInput {
  /** Own-draft state: flag dispositions are unreachable (read-only mirror), so progress is chunk read-through only. */
  ownDraftActive: boolean;
  totals: ProgressTotals;
  flagCount: number;
  chunkCount: number;
}

/** Overall review progress in percent (0–100); 0 when there is no work. */
export function deriveBriefProgress(input: DeriveBriefProgressInput): number {
  const { ownDraftActive, totals, flagCount, chunkCount } = input;
  const totalWork = ownDraftActive ? chunkCount : flagCount + chunkCount;
  const done = ownDraftActive
    ? totals.reviewed
    : totals.reviewed + totals.flagsResolved;
  return totalWork === 0 ? 0 : (done / totalWork) * 100;
}

export interface LocalComparisonIds {
  marksId: string | undefined;
  narrativeId: string | undefined;
  deltaId: string | undefined;
}

/**
 * The active baseline's local sidecar ids: marks follow the baseline;
 * narrative is previous-brief-only, delta last-review-only.
 */
export function resolveLocalComparisonIds(
  compare: CompareParam,
  comparisons: ComparisonAvailability | undefined,
): LocalComparisonIds {
  return {
    marksId:
      compare === "previous-brief"
        ? comparisons?.previousBrief?.marksId
        : compare === "last-review"
          ? comparisons?.lastReview?.marksId
          : undefined,
    narrativeId:
      compare === "previous-brief"
        ? comparisons?.previousBrief?.narrativeId
        : undefined,
    deltaId:
      compare === "last-review" ? comparisons?.lastReview?.deltaId : undefined,
  };
}

export interface DiscriminatedNarrative {
  narrative: RevisionNarrative | null;
  skipReason: RevisionNarrativeSkipReason | null;
}

/**
 * An artifact's presence only means "something was fetched"; a skip stub is
 * narrative-unavailable with a knowable reason — discriminate on the kind.
 */
export function discriminateNarrativeArtifact(
  artifact: RevisionNarrativeArtifact | null,
): DiscriminatedNarrative {
  if (artifact === null) return { narrative: null, skipReason: null };
  return artifact.artifactKind === "revisionNarrative"
    ? { narrative: artifact, skipReason: null }
    : { narrative: null, skipReason: artifact.skipped };
}

/**
 * Batch "post my drafts, then mark ready" failure toast: honest counts prefix
 * and the explicit NOT-marked-ready suffix on every variant; guidance branches
 * on the stop-cause. Only `indeterminate` reads as may-have-posted — a
 * confident "not posted" there would invite a double-posting retry.
 */
export function markReadyBatchFailureCopy(
  posted: number,
  total: number,
  cause: Exclude<PostDraftOutcome, "posted">,
): string {
  const counts = `Posted ${String(posted)} of ${String(total)}.`;
  const suffix = "The PR was NOT marked ready.";
  switch (cause) {
    case "rejected":
      return `${counts} One comment was rejected before posting — edit the draft and try again. ${suffix}`;
    case "unauthorized":
      return `${counts} One comment could not be posted — your GitHub session expired, sign in again to continue. ${suffix}`;
    case "stale":
      return `${counts} One comment could not be posted — the pull request has newer commits, reload to post against the current diff. ${suffix}`;
    case "not-found":
      return `${counts} One comment could not be posted — this pull request is no longer accessible on GitHub. ${suffix}`;
    case "indeterminate":
      return `${counts} One comment may or may not have posted — check GitHub before retrying. ${suffix}`;
  }
}

/** The running batch's confirm-button pending label, if a batch runs. */
export function markReadyBatchBusyLabel(
  batch: { current: number; total: number } | null,
): string | undefined {
  return batch !== null
    ? `Posting ${String(batch.current)} of ${String(batch.total)}…`
    : undefined;
}

/** A copy of `current` with `member` toggled in or out. */
export function toggleSetMember(
  current: ReadonlySet<string>,
  member: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(member)) next.delete(member);
  else next.add(member);
  return next;
}

/**
 * Address-with-evidence resolution: linked-comment without a chosen comment
 * falls back to chunk-reviewed on the flag's chunk.
 */
export function resolveRiskEvidence(
  kind: RiskEvidenceKind,
  commentId: string | undefined,
  note: string | undefined,
  chunkId: string,
): RiskEvidence {
  if (kind === "linked-comment")
    return commentId
      ? { kind, commentId }
      : { kind: "chunk-reviewed", chunkId };
  if (kind === "chunk-reviewed") return { kind, chunkId };
  return note ? { kind, note } : { kind };
}
