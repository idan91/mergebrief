import type { CheckRun, CommitStatus, SubmittedReview } from "github";
import type { TriggerConditionValues } from "generators/trigger-conditions";
import type {
  SizeMeasure,
  TriggerConditionKind,
  TriggerConditionSetter,
  UnmetPlainCondition,
} from "types/trigger-conditions";
import type { ConditionStamps } from "persistence";
import type { ValueOf } from "types/utils";

/**
 * What reported on the head, read only when a condition needs it; every
 * list is empty otherwise.
 */
export interface HeadReports {
  readonly checkRuns: readonly CheckRun[];
  /** Newest first, as GitHub lists them. */
  readonly statuses: readonly CommitStatus[];
  /** GitHub refused the check-run or status read: the installation lacks Checks or Commit statuses read. */
  readonly statusChecksForbidden: boolean;
  /**
   * Oldest first, on any commit; a check keeps those on the head. Read for
   * `bots`, and for `reviewRequested` while no request or stamp meets it.
   */
  readonly reviews: readonly SubmittedReview[];
  /** The base branch's ruleset-required check names; read only for `ci: required`. */
  readonly requiredChecks: readonly string[];
}

/** What the check knows about the push, read fresh from GitHub this run. */
export interface ConditionFacts {
  readonly draft: boolean;
  readonly title: string;
  readonly headSha: string;
  /** The branch the pull request targets directly; absent when GitHub named none. */
  readonly baseRef?: string;
  /** Private and not internal, so every reviewer was invited. */
  readonly repoPrivate: boolean;
  readonly labels: readonly string[];
  /** Absent when the author's account is gone; their own review never meets `reviewRequested`. */
  readonly authorLogin?: string | undefined;
  readonly pendingReviewRequests: number;
  /** The conditions this PR met on an earlier run or webhook and keeps met. */
  readonly stamps: ConditionStamps;
  /** GitHub's totals for the whole pull request, per `size` measure. */
  readonly sizes: Readonly<Record<SizeMeasure, number>>;
  /**
   * Each changed file's path as GitHub lists it, a rename by its new path, a
   * deletion by the path it had. Absent until a `paths` condition can decide
   * the verdict.
   */
  readonly changedPaths?: readonly string[] | undefined;
  /** Each renamed file's old path, read with `changedPaths`. */
  readonly previousPaths?: readonly string[] | undefined;
  /**
   * Whether a changed path or a rename's old one matched the `paths` globs,
   * from the run's one scan (`addPathsMatch`); a scan past its budget is
   * false. Absent when nothing was scanned.
   */
  readonly pathsMatched?: boolean;
  readonly reports: HeadReports;
}

export interface KindCheckInput<Kind extends TriggerConditionKind> {
  readonly value: TriggerConditionValues[Kind];
  readonly setBy: TriggerConditionSetter;
  readonly facts: ConditionFacts;
}

/** A kind's check: the unmet items it leaves, none when the push meets it. */
export type KindCheck<Kind extends TriggerConditionKind> = (
  input: KindCheckInput<Kind>,
) => UnmetPlainCondition[];

/** Where one named check stands on the head under GitHub's merge rule. */
export const CheckOutcomes = {
  PASSED: "passed",
  FAILED: "failed",
  RUNNING: "running",
  MISSING: "missing",
} as const;
export type CheckOutcome = ValueOf<typeof CheckOutcomes>;

/** A review bot's own GitHub accounts; a bot without an App reports only through reviews. */
export interface ReviewBotAccount {
  readonly appId?: bigint;
  readonly userId: bigint;
}
