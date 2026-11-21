import type { UnmetCondition } from "types/trigger-conditions";

/** A held head's unmet conditions, grouped by what clears them. */
export interface HeldConditionSplit {
  /** Clears by itself: a bot or CI still working. */
  readonly waits: readonly UnmetCondition[];
  /** Needs someone to act before the head generates by itself. */
  readonly needs: readonly UnmetCondition[];
}
