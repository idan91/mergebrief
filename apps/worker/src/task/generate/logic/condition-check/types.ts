import type { SizeMeasure } from "types/trigger-conditions";

/** What the check knows about the push, read fresh from GitHub this run. */
export interface ConditionFacts {
  readonly draft: boolean;
  readonly title: string;
  /** The branch the pull request targets directly; absent when GitHub named none. */
  readonly baseRef?: string;
  readonly labels: readonly string[];
  readonly pendingReviewRequests: number;
  /** GitHub's totals for the whole pull request, per `size` measure. */
  readonly sizes: Readonly<Record<SizeMeasure, number>>;
  /**
   * Each changed file's path as GitHub lists it: a rename by its new path, a
   * deletion by the path it had. Empty unless a `paths` condition is set.
   */
  readonly changedPaths: readonly string[];
}
