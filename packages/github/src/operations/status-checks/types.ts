import type { ValueOf } from "types/utils";
import type { GitHubAccountType } from "../../types";

/** A commit in one repository, by SHA or branch name. */
export interface CommitRef {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
}

export interface BranchRef {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
}

/** GitHub's wire values for a completed check run's conclusion. */
export const CheckRunConclusions = {
  SUCCESS: "success",
  NEUTRAL: "neutral",
  SKIPPED: "skipped",
  FAILURE: "failure",
  CANCELLED: "cancelled",
  TIMED_OUT: "timed_out",
  ACTION_REQUIRED: "action_required",
  STALE: "stale",
  STARTUP_FAILURE: "startup_failure",
} as const;
export type CheckRunConclusion = ValueOf<typeof CheckRunConclusions>;

/** GitHub's wire values for a commit status's state. */
export const CommitStatusStates = {
  PENDING: "pending",
  SUCCESS: "success",
  FAILURE: "failure",
  ERROR: "error",
} as const;
export type CommitStatusState = ValueOf<typeof CommitStatusStates>;

export interface CheckRun {
  /** GitHub numbers runs in creation order, so a higher id is a later run. */
  readonly checkRunId: bigint;
  readonly name: string;
  /** The App that created the run; GitHub sets it and no other App can forge it. */
  readonly appId?: bigint;
  readonly completed: boolean;
  /** GitHub's wire value, on a completed run only; a value GitHub adds later stays as sent. */
  readonly conclusion?: string;
  readonly title?: string;
  /** The run's details text, as the App wrote it. */
  readonly text?: string;
}

export interface CommitStatus {
  readonly context: string;
  readonly state: CommitStatusState;
  /** The account that posted the status. */
  readonly creatorId?: bigint;
  /** `Bot` for an App's account; absent when GitHub omits it or sends a type we do not know. */
  readonly creatorType?: GitHubAccountType;
}

/** A check a ruleset requires; `appId` is set when the rule pins the check to one App. */
export interface RequiredStatusCheck {
  readonly context: string;
  readonly appId?: bigint;
}
