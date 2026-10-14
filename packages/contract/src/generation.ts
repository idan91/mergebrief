// A generation as the wire reports it, and why a pending one has not started.
import type {
  GenerationFailureCode,
  GenerationFailureParams,
  GenerationPhase,
  GenerationStatus,
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
