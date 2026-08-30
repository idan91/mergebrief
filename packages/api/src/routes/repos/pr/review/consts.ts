import { ReviewEvents, type ReviewEvent } from "github";
import { ReviewOutcomes, type ReviewOutcome } from "./types";

/** The FE's outcome vocabulary → GitHub's review event (1:1, never inferred). */
export const OutcomeToEvent: Readonly<Record<ReviewOutcome, ReviewEvent>> = {
  [ReviewOutcomes.COMMENT]: ReviewEvents.COMMENT,
  [ReviewOutcomes.APPROVE]: ReviewEvents.APPROVE,
  [ReviewOutcomes.REQUEST_CHANGES]: ReviewEvents.REQUEST_CHANGES,
};
