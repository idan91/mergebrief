// A generation as the wire reports it, and why a pending one has not started.
import type {
  GenerationFailureCode,
  GenerationFailureParams,
  GenerationPhase,
  GenerationStatus,
  TakeoverJobStates,
  ValueOf,
} from "types";

/** Response vocabulary only, never stored, so no DB CHECK and no migration. */
export const WaitReasons = {
  /** The queued job's start time is still ahead: the push debounce holds it. */
  DEBOUNCING: "debouncing",
  /** The job is due and no worker slot has claimed it. */
  WAITING_FOR_SLOT: "waiting-for-slot",
} as const;
export type WaitReason = ValueOf<typeof WaitReasons>;

export interface GenerationSummaryView {
  readonly status: GenerationStatus;
  readonly phase: GenerationPhase | null;
  readonly attempts: number;
  /** Modeled data inside a 200, not a wire `ApiErrorCode`. */
  readonly errorCode: GenerationFailureCode | null;
  /** Interpolation params for the code's template; `detail` pre-sanitized. */
  readonly errorParams: GenerationFailureParams | null;
  readonly updatedAt: string;
  /**
   * Present only on the PR meta, and only while the generation is pending
   * with a queued job no worker holds. The Inbox never fills it.
   */
  readonly waitReason?: WaitReason;
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
  readonly errorParams?: GenerationFailureParams;
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
