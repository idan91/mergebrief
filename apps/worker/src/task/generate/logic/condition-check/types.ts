import type { SizeMeasure } from "types/trigger-conditions";

/** What the check knows about the push, read fresh from GitHub this run. */
export interface ConditionFacts {
  readonly draft: boolean;
  readonly title: string;
  /** The branch the pull request targets directly; empty when GitHub named none. */
  readonly baseRef: string;
  readonly labels: readonly string[];
  readonly pendingReviewRequests: number;
  /** GitHub's totals for the whole pull request, per `size` measure. */
  readonly sizes: Readonly<Record<SizeMeasure, number>>;
}
