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

export const MS_PER_SECOND = 1000;

/**
 * How far before a claim's stamp the in-doubt lookup reaches. GitHub stamps
 * whole seconds on its own clock; author, body and anchor keep a wide
 * window from matching anything else.
 */
export const IN_DOUBT_LOOKUP_MARGIN_MS = 5 * 60 * MS_PER_SECOND;

/** How long before a claim's lease runs out its last GitHub write may leave. */
export const WRITE_DEADLINE_MARGIN_MS = 30 * MS_PER_SECOND;

/** The FE's outcome vocabulary → GitHub's review event (1:1, never inferred). */
export const OutcomeToEvent: Readonly<Record<ReviewOutcome, ReviewEvent>> = {
  [ReviewOutcomes.COMMENT]: ReviewEvents.COMMENT,
  [ReviewOutcomes.APPROVE]: ReviewEvents.APPROVE,
  [ReviewOutcomes.REQUEST_CHANGES]: ReviewEvents.REQUEST_CHANGES,
};
