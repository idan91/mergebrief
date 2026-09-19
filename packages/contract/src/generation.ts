// Why a pending generation has not started yet, as the PR meta reports it.
import type { ValueOf } from "types/utils";

/** The stored phase vocabulary, typed here so a client lookup breaks the build when a phase is added. */
export type { GenerationPhase } from "persistence";

/** Response vocabulary only, never stored, so no DB CHECK and no migration. */
export const WaitReasons = {
  /** The queued job's start time is still ahead: the push debounce holds it. */
  DEBOUNCING: "debouncing",
  /** The job is due and no worker slot has claimed it. */
  WAITING_FOR_SLOT: "waiting-for-slot",
} as const;
export type WaitReason = ValueOf<typeof WaitReasons>;
