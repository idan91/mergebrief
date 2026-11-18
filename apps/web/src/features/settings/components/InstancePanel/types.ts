import type { ValueOf } from "types/utils";

/** How close today's started runs sit to the daily cap. */
export const SpendLevels = {
  UNCAPPED: "uncapped",
  CLEAR: "clear",
  NEAR: "near",
  CAPPED: "capped",
} as const;
export type SpendLevel = ValueOf<typeof SpendLevels>;

/** The sentence that says a capped Instance's count. */
export type CountSentenceKey =
  | "spend.startedOfCap"
  | "spend.allUsed"
  | "spend.overCap";

/** A spend read as the panel says it: the level and when the count resets. */
export interface SpendReading {
  readonly level: SpendLevel;
  readonly resetLocal: string;
  readonly resetUtc: string;
  /** `in 6 hours`, in the viewer's locale. */
  readonly resetRelative: string;
  /** The viewer's clock reads the reset as UTC does, so one time says it. */
  readonly localIsUtc: boolean;
  /** When the shown count was read, on the viewer's clock. */
  readonly readAtLocal: string;
}
