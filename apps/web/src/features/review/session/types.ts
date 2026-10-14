import { DispositionDecisions, type ValueOf } from "types";

/** A flag's state in the session: one of the two stored decisions, or none yet. */
export const DispositionKinds = {
  OPEN: "open",
  ADDRESSED: DispositionDecisions.ADDRESSED,
  DISMISSED: DispositionDecisions.DISMISSED,
} as const;
export type DispositionKind = ValueOf<typeof DispositionKinds>;
