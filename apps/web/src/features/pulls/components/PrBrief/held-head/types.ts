import type { HeldCondition } from "../../../types";

/** A held head's unmet conditions, grouped by what clears them. */
export interface HeldConditionSplit {
  /** Clears by itself: a bot or CI still working. */
  readonly waits: readonly HeldCondition[];
  /** Needs someone to act before the head generates by itself. */
  readonly needs: readonly HeldCondition[];
}
