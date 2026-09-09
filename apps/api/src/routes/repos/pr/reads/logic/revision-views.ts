// Shapes one browsable revision entry from the pre-joined artifact listings,
// pure composition over the tested derivations in revision-comparisons.
import type { BriefSpanRow } from "persistence";
import type {
  LastReviewComparisonView,
  PreviousBriefComparisonView,
  RevisionView,
} from "contract";
import {
  derivePreviousBriefComparison,
  deriveLastReviewComparison,
  type CheckpointBaseline,
} from "./revision-comparisons";

export interface RevisionViewContext {
  readonly briefs: readonly BriefSpanRow[];
  readonly markSpans: ReadonlySet<string>;
  readonly deltaSpans: ReadonlySet<string>;
  readonly narrativeSpans: ReadonlySet<string>;
  readonly checkpoint: CheckpointBaseline | undefined;
  /** First-enqueue time per head; fallback is the artifact's own write time. */
  readonly generatedAtByHead: ReadonlyMap<string, Date>;
  readonly currentHeadSha: string;
  readonly latestPendingProbe: (baselineSha: string) => Promise<boolean>;
}

export async function buildRevisionView(
  entry: BriefSpanRow,
  ctx: RevisionViewContext,
): Promise<RevisionView> {
  const previousBrief = derivePreviousBriefComparison(
    entry,
    ctx.briefs,
    ctx.markSpans,
    ctx.narrativeSpans,
  );
  const lastReview = await deriveLastReviewComparison(
    entry.headSha,
    ctx.checkpoint,
    ctx.briefs,
    ctx.markSpans,
    ctx.deltaSpans,
    entry.headSha === ctx.currentHeadSha ? ctx.latestPendingProbe : undefined,
  );
  const comparisons: {
    previousBrief?: PreviousBriefComparisonView;
    lastReview?: LastReviewComparisonView;
  } = {};
  if (previousBrief !== undefined) {
    comparisons.previousBrief = previousBrief;
  }
  if (lastReview !== undefined) {
    comparisons.lastReview = lastReview;
  }
  return {
    headSha: entry.headSha,
    baseSha: entry.baseSha,
    headIndex: entry.headIndex,
    createdAt: entry.createdAt.toISOString(),
    // Missing projection row: the artifact's own write time is the honest
    // late fallback, never earlier than the real generation start, so it
    // can only under-mark.
    generatedAt: (
      ctx.generatedAtByHead.get(entry.headSha) ?? entry.createdAt
    ).toISOString(),
    comparisons,
  };
}
