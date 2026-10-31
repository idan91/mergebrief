// The PR-meta comparison machinery: span-existence joins and the
// previous-brief / last-review derivations. Pure over lean listing rows,
// the one DB probe (generation pending) is injected.
import {
  LastReviewUnavailableReasons,
  type AvailableLastReviewComparisonView,
  type LastReviewComparisonView,
  type PreviousBriefComparisonView,
} from "contract";
import {
  GenerationKinds,
  type BriefSpanRow,
  type ComparisonSpanRow,
  type DeltaSpanRow,
  type GenerationProjection,
  type GenerationRow,
  type NarrativeSpanRow,
  type PullRequestRow,
} from "persistence";
import { GenerationStatuses, type GenerationStatus } from "types/generations";
import type { Mutable } from "types/utils";

// Span-existence joins: a `Set` of packed keys turns per-revision availability
// into an in-memory lookup (space separator. SHAs are hex, never contain it).
const SPAN_KEY_SEP = " ";
export function spanKey(baseline: string, head: string): string {
  return `${baseline}${SPAN_KEY_SEP}${head}`;
}
export function comparisonSpanSet(
  rows: readonly ComparisonSpanRow[],
): ReadonlySet<string> {
  return new Set(rows.map((row) => spanKey(row.baselineSha, row.headSha)));
}
/** A span's delta row is a Delta Brief to offer or the skip record standing in for one. */
export interface DeltaSpanSets {
  readonly available: ReadonlySet<string>;
  readonly skipped: ReadonlySet<string>;
}

export function buildDeltaSpanSets(
  rows: readonly DeltaSpanRow[],
): DeltaSpanSets {
  const available = new Set<string>();
  const skipped = new Set<string>();
  for (const row of rows) {
    const key = spanKey(row.baselineSha, row.headSha);
    if (row.skipped) {
      skipped.add(key);
    } else {
      available.add(key);
    }
  }
  return { available, skipped };
}

export function narrativeSpanSet(
  rows: readonly NarrativeSpanRow[],
): ReadonlySet<string> {
  return new Set(rows.map((row) => spanKey(row.prevHeadSha, row.headSha)));
}

/**
 * Previous-brief comparison availability for a GIVEN briefed head: the
 * highest-index brief BELOW this one whose head differs (the worker's own
 * baseline rule), restricting to a lower index is what makes this correct for
 * a HISTORICAL head, not only the latest. Offered only when the mechanical
 * marks row exists (marks are the sole highlight truth); a missing narrative
 * only downgrades `narrativeAvailable`.
 */
export function derivePreviousBriefComparison(
  target: BriefSpanRow,
  briefs: readonly BriefSpanRow[],
  markSpans: ReadonlySet<string>,
  narrativeSpans: ReadonlySet<string>,
): PreviousBriefComparisonView | undefined {
  // `briefs` is ordered by headIndex ascending → the last lower-index match is
  // the highest-index previous briefed head.
  let previous: BriefSpanRow | undefined;
  for (const row of briefs) {
    if (row.headIndex < target.headIndex && row.headSha !== target.headSha) {
      previous = row;
    }
  }
  if (previous === undefined) {
    return undefined;
  }
  if (!markSpans.has(spanKey(previous.headSha, target.headSha))) {
    return undefined;
  }
  return {
    baselineSha: previous.headSha,
    baselineIndex: previous.headIndex,
    narrativeAvailable: narrativeSpans.has(
      spanKey(previous.headSha, target.headSha),
    ),
  };
}

function isNonTerminal(status: GenerationStatus): boolean {
  return (
    status === GenerationStatuses.PENDING ||
    status === GenerationStatuses.RUNNING
  );
}

/** The requesting reviewer's checkpoint slice `deriveLastReviewComparison` needs. */
export interface CheckpointBaseline {
  readonly lastSubmittedSha: string;
}

/**
 * Probe whether a still-absent marks span is PENDING or permanently
 * BASELINE_UNAVAILABLE, the one DB read the `lastReview` derivation may need.
 * Wired for the LATEST head only and memoized per baseline, so at most one
 * generation query per request. Two pending signals, because production
 * writes no delta-kind projection rows today: the current head's BRIEF
 * generation is still non-terminal and marks land before it succeeds, so its
 * warming window IS the delta's; and a non-terminal delta-kind row for the
 * exact span, kept for when delta generation gets its own projection.
 */
export function makeLatestPendingProbe(
  generations: GenerationProjection,
  pullRequestId: PullRequestRow["id"],
  headSha: string,
  latestBriefGeneration: GenerationRow | undefined,
): (baselineSha: string) => Promise<boolean> {
  const memo = new Map<string, Promise<boolean>>();
  return (baselineSha) => {
    const hit = memo.get(baselineSha);
    if (hit !== undefined) {
      return hit;
    }
    const result = (async (): Promise<boolean> => {
      const briefGenPending =
        latestBriefGeneration !== undefined &&
        latestBriefGeneration.headSha === headSha &&
        isNonTerminal(latestBriefGeneration.status);
      if (briefGenPending) {
        return true;
      }
      const deltaGeneration = await generations.get({
        pullRequestId,
        kind: GenerationKinds.DELTA,
        headSha,
        baselineSha,
      });
      return (
        deltaGeneration !== undefined && isNonTerminal(deltaGeneration.status)
      );
    })();
    memo.set(baselineSha, result);
    return result;
  };
}

/**
 * Derive `lastReview` at a GIVEN head from the REQUESTING reviewer's checkpoint.
 * Absent when there is nothing to explain: no checkpoint, or the checkpoint IS
 * this head (empty span). Marks existence IS the offer; row existence also
 * encodes DIRECTION, the worker only warms forward spans, so a checkpoint
 * newer than this head simply has no marks and offers nothing.
 *
 * `pendingProbe` is supplied for the latest head only; for a historical head a
 * missing marks span is BASELINE_UNAVAILABLE outright.
 */
export async function deriveLastReviewComparison(
  headSha: string,
  checkpoint: CheckpointBaseline | undefined,
  briefs: readonly BriefSpanRow[],
  markSpans: ReadonlySet<string>,
  deltaSpans: DeltaSpanSets,
  pendingProbe: ((baselineSha: string) => Promise<boolean>) | undefined,
): Promise<LastReviewComparisonView | undefined> {
  if (checkpoint === undefined || checkpoint.lastSubmittedSha === headSha) {
    return undefined;
  }
  const baselineSha = checkpoint.lastSubmittedSha;
  const span = spanKey(baselineSha, headSha);
  if (markSpans.has(span)) {
    // Deterministic: `briefs` is headIndex-ascending, so `find` resolves the
    // LOWEST index when duplicate rows share the checkpoint SHA (a retarget
    // re-brief), either duplicate labels the same commit.
    const baselineIndex = briefs.find(
      (row) => row.headSha === baselineSha,
    )?.headIndex;
    const view: Mutable<AvailableLastReviewComparisonView> = {
      deltaAvailable: deltaSpans.available.has(span),
      baselineSha,
    };
    if (deltaSpans.skipped.has(span)) {
      view.deltaSkipped = true;
    }
    if (baselineIndex !== undefined) {
      view.baselineIndex = baselineIndex;
    }
    return view;
  }
  // A span GitHub refused has no marks; its skip record says why, not a probe.
  if (deltaSpans.skipped.has(span)) {
    return { unavailable: LastReviewUnavailableReasons.SPAN_TOO_LARGE };
  }
  const pending =
    pendingProbe !== undefined && (await pendingProbe(baselineSha));
  return {
    unavailable: pending
      ? LastReviewUnavailableReasons.PENDING
      : LastReviewUnavailableReasons.BASELINE_UNAVAILABLE,
  };
}
