import { ReviewEvent } from "github";
import { ReviewOutcomes, type ReviewOutcome } from "./types";

/** The FE's outcome vocabulary → GitHub's review event (1:1, never inferred). */
export const OutcomeToEvent: Readonly<Record<ReviewOutcome, ReviewEvent>> = {
  [ReviewOutcomes.COMMENT]: ReviewEvent.COMMENT,
  [ReviewOutcomes.APPROVE]: ReviewEvent.APPROVE,
  [ReviewOutcomes.REQUEST_CHANGES]: ReviewEvent.REQUEST_CHANGES,
};
