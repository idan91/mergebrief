import type {
  BotVerdict,
  UnmetBot,
  UnmetConditionKinds,
  UnmetPlainCondition,
} from "types/trigger-conditions";

import type { UnknownValue } from "@web/utils/open-enum/types";

/** A bot item as this bundle reads it: the verdict is never shown, so one it predates reads `unknown`. */
export interface HeldBot extends Omit<UnmetBot, "verdict"> {
  readonly verdict: BotVerdict | UnknownValue;
}

export type HeldPlainCondition =
  | Exclude<UnmetPlainCondition, UnmetBot>
  | HeldBot;

/** An `any` group with the members this bundle reads. */
export interface HeldAnyGroup {
  readonly kind: typeof UnmetConditionKinds.ANY;
  readonly conditions: readonly HeldPlainCondition[];
}

/** One unmet condition of a held head, as this bundle reads it. */
export type HeldCondition = HeldPlainCondition | HeldAnyGroup;

/** A held head's unmet conditions, grouped by what clears them. */
export interface HeldConditionSplit {
  /** Clears by itself: a bot or CI still working. */
  readonly waits: readonly HeldCondition[];
  /** Needs someone to act before the head generates by itself. */
  readonly needs: readonly HeldCondition[];
}
