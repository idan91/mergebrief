// The dev-only local Brief file surface on the wire: the listing's rows and
// the one read that names which artifact it served. Every body stays
// `unknown`: the reader parses it, as it does the stored PR artifacts.
import type { ValueOf } from "types/utils";

export const LocalBriefKinds = {
  BRIEF: "brief",
  DELTA: "delta",
} as const;
export type LocalBriefKind = ValueOf<typeof LocalBriefKinds>;

export interface LocalPreviousBriefAvailability {
  readonly marksId: string;
  /** Present whenever a narrative sidecar exists, a skip stub included. */
  readonly narrativeId?: string;
  readonly baselineSha: string;
  readonly baselineIndex: number;
}

export interface LocalLastReviewAvailability {
  readonly marksId: string;
  /** Marks can exist without a Delta: they are written before it. */
  readonly deltaId?: string;
  /** No delta will come: the span was too large, and a skip record stands in for it. */
  readonly deltaSkipped?: true;
  /** No Delta Brief is owed: the PR's own change did not move since the checkpoint. */
  readonly deltaUnchanged?: true;
  readonly baselineSha: string;
  readonly baselineIndex: number | null;
}

/** An absent key means that baseline has no marks for this head. */
export interface LocalComparisonAvailability {
  readonly previousBrief?: LocalPreviousBriefAvailability;
  readonly lastReview?: LocalLastReviewAvailability;
}

/** One row of `GET /api/local-briefs`. */
export interface LocalBriefSummary {
  readonly id: string;
  readonly artifactKind: LocalBriefKind;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly sha: string;
  readonly index?: number;
  readonly baselineSha?: string;
  readonly headSha?: string;
  readonly baselineIndex?: number | null;
  readonly headIndex?: number | null;
  /** Only on `brief` rows. */
  readonly comparisons?: LocalComparisonAvailability;
}

/** `GET /api/local-briefs/:briefId`: the stored body and its comments sidecar, unparsed. */
export interface LocalBriefView {
  readonly artifactKind: LocalBriefKind;
  readonly body: unknown;
  readonly reviewComments?: unknown;
}
