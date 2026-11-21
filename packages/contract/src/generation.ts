// A generation as the wire reports it, and why a pending one has not started.
import type {
  GenerationFailureCode,
  GenerationErrorParams,
  GenerationPhase,
  GenerationStatus,
  TakeoverJobStates,
  UnmetCondition,
  ValueOf,
} from "types";

/** Response vocabulary only, never stored, so no DB CHECK and no migration. */
export const WaitReasons = {
  /** The queued job's start time is still ahead: the push debounce holds it. */
  DEBOUNCING: "debouncing",
  /** The job is due and no worker slot has claimed it. */
  WAITING_FOR_SLOT: "waiting-for-slot",
  /** The job spent its attempts and no Takeover is queued: nothing will run the head. */
  STALLED: "stalled",
} as const;
export type WaitReason = ValueOf<typeof WaitReasons>;

/**
 * A multi-call run's progress: its grouping's planned detail calls, stored
 * ones included, and how many are done.
 */
export interface GenerationPartsView {
  readonly done: number;
  readonly total: number;
}

export interface GenerationSummaryView {
  readonly status: GenerationStatus;
  readonly phase: GenerationPhase | null;
  readonly attempts: number;
  /** Modeled data inside a 200, not a wire `ApiErrorCode`. */
  readonly errorCode: GenerationFailureCode | null;
  /** Interpolation params for the code's template; `detail` pre-sanitized. */
  readonly errorParams: GenerationErrorParams | null;
  readonly updatedAt: string;
  /**
   * Present only on the PR meta, and only while the generation is pending
   * with a queued job no worker holds. The Inbox never fills it.
   */
  readonly waitReason?: WaitReason;
  /**
   * PR meta only, while a run holds the row: when its attempt started, ISO
   * 8601, and, once a multi-call run's grouping call planned its detail
   * calls, how many of them are done.
   */
  readonly startedAt?: string;
  readonly parts?: GenerationPartsView;
  /**
   * Present only while the status is `held`: every trigger condition the
   * head has not met, each naming whose setting it is. `kind` is a closed
   * vocabulary a reader takes as open: an item of a kind it does not know is
   * dropped, never a failure of the response.
   */
  readonly unmetConditions?: readonly UnmetCondition[];
}

export interface ScheduledTakeoverView {
  readonly state: typeof TakeoverJobStates.SCHEDULED;
  /** When the job may start, ISO 8601. */
  readonly runsAt: string;
}

export interface RunningTakeoverView {
  readonly state: typeof TakeoverJobStates.RUNNING;
}

export interface SpentTakeoverView {
  readonly state: typeof TakeoverJobStates.SPENT;
}

/** The head's takeover job: waiting, running, or out of attempts. */
export type TakeoverView =
  | ScheduledTakeoverView
  | RunningTakeoverView
  | SpentTakeoverView;

/** The current head's claims, as `read-generation-claims` reports them. */
export interface GenerationClaimsView {
  readonly headSha: string;
  readonly status: GenerationStatus;
  /** Claims taken since the last trigger. */
  readonly claims: number;
  readonly claimLimit: number;
  /** No claim is left: not succeeded, no live claim, and the limit taken. */
  readonly exhausted: boolean;
  /** The stored failure, kept as is; an exhausted head may carry an earlier one. */
  readonly errorCode?: GenerationFailureCode;
  readonly errorParams?: GenerationErrorParams;
  /** Absent when no takeover job is queued for the head. */
  readonly takeover?: TakeoverView;
}

/** What `read-generation-claims` answers; no `generation` before the first brief is queued. */
export interface GenerationClaimsResponse {
  readonly generation?: GenerationClaimsView;
}

/** `generate-brief`: a GitHub pull request URL. */
export interface GenerateBriefBody {
  readonly url: string;
}

/** What `generate-brief` answers, with 202: where the queued brief will render. */
export interface GenerateBriefResponse {
  readonly repoId: string;
  readonly prNumber: number;
}
