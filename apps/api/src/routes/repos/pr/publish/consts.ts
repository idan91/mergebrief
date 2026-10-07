import {
  ReviewCommentSides,
  ReviewEvents,
  type ReviewCommentSide,
  type ReviewEvent,
} from "github";
import { DraftCommentSides, type DraftCommentSide } from "types/comments";
import { ReviewOutcomes, type ReviewOutcome } from "types/reviews";

/** The stored side vocabulary as GitHub names it. */
export const SideOnGithub: Readonly<
  Record<DraftCommentSide, ReviewCommentSide>
> = {
  [DraftCommentSides.OLD]: ReviewCommentSides.LEFT,
  [DraftCommentSides.NEW]: ReviewCommentSides.RIGHT,
};

/** The FE's outcome vocabulary → GitHub's review event (1:1, never inferred). */
export const OutcomeToEvent: Readonly<Record<ReviewOutcome, ReviewEvent>> = {
  [ReviewOutcomes.COMMENT]: ReviewEvents.COMMENT,
  [ReviewOutcomes.APPROVE]: ReviewEvents.APPROVE,
  [ReviewOutcomes.REQUEST_CHANGES]: ReviewEvents.REQUEST_CHANGES,
};
