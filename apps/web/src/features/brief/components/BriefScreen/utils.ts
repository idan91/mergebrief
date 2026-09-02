// Closure-free BriefScreen logic: derivations extracted from the screen/hooks
// so they are unit-testable directly, without rendering.
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
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
 * Per-group changed-since counts: DISTINCT member files with a nonempty entry
 * in the last-review marks. `undefined` without marks — no checkpoint means no
 * marker, distinct from a checkpoint with zero changes. Mechanical marks only:
 * narrative/Delta text never decides the count.
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
 * Soft-gate line: count of precise stated-but-missing asks. Zero on
 * broad/none or a pre-feature Brief. Never feeds the gate's OPEN condition.
 */
export function countIntentGaps(intentCheck: IntentCheck | undefined): number {
  return intentCheck?.specificity === "precise"
    ? intentCheck.statedButMissing.length
    : 0;
}

/**
 * Soft-gate line 2: count of precise intent TENSIONS — unacknowledged
 * deviations plus claimed-but-unachieved. Acknowledged deviations are excluded:
 * the description already owns that reversal. Never part of the gate's OPEN
 * condition.
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
const BATCH_CAUSE_KEYS = {
  rejected: "brief.markReadyBatch.causeRejected",
  unauthorized: "brief.markReadyBatch.causeUnauthorized",
  stale: "brief.markReadyBatch.causeStale",
  "not-found": "brief.markReadyBatch.causeNotFound",
  indeterminate: "brief.markReadyBatch.causeIndeterminate",
} as const satisfies Record<
  Exclude<PostDraftOutcome, "posted">,
  TranslationKey
>;

export function markReadyBatchFailureCopy(
  t: TFunction,
  posted: number,
  total: number,
  cause: Exclude<PostDraftOutcome, "posted">,
): string {
  return [
    t("brief.markReadyBatch.counts", { posted, total }),
    t(BATCH_CAUSE_KEYS[cause]),
    t("brief.markReadyBatch.suffix"),
  ].join(" ");
}

/** The running batch's confirm-button pending label, if a batch runs. */
export function markReadyBatchBusyLabel(
  t: TFunction,
  batch: { current: number; total: number } | null,
): string | undefined {
  return batch !== null
    ? t("brief.markReadyBatch.busyLabel", {
        current: batch.current,
        total: batch.total,
      })
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

/** User inputs that abort an in-flight programmatic landing. */
export const SCROLL_ABORT_EVENTS = ["wheel", "touchstart", "keydown"] as const;

/**
 * Marks where the change content begins, directly below the brief's overview
 * blocks. The header observes this element to know the moment that content
 * reaches it, and collapses its title then. It is a behavioural attribute
 * that runtime code queries — never a styling or test hook — and it sits
 * outside both views so switching between them cannot unmount it.
 */
export const CONTENT_START_ATTR = "data-content-start";

/** The focus target of a sidebar-originated jump: the group card's heading. */
export function deriveGroupHeadingId(groupId: string): string {
  return `${groupId}-heading`;
}

/** The in-flow anchor of a group: its section, which heads the card at every width. */
export function deriveGroupSectionId(groupId: string): string {
  return `${groupId}-section`;
}
