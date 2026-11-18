import { InboxReviewStates, type InboxReviewState } from "types/inbox";

import { IconNames, type IconName } from "../Icon/types";

/** Each review state's drawing from the set; every consumer draws the same pairing. */
export const ReviewMarkIconNames: Readonly<Record<InboxReviewState, IconName>> =
  {
    [InboxReviewStates.NEW]: IconNames.CIRCLE,
    [InboxReviewStates.IN_PROGRESS]: IconNames.CIRCLE_HALF,
    [InboxReviewStates.UPDATED]: IconNames.RECORD,
    [InboxReviewStates.REVIEWED]: IconNames.CHECK_CIRCLE,
  };

/** Each review state's name in the catalog. */
export const ReviewMarkLabelKeys = {
  [InboxReviewStates.NEW]: "shell.marks.new",
  [InboxReviewStates.IN_PROGRESS]: "shell.marks.inProgress",
  [InboxReviewStates.UPDATED]: "shell.marks.updated",
  [InboxReviewStates.REVIEWED]: "shell.marks.reviewed",
} as const;

/** The states in the order a legend lists them: the ones that need the reviewer first. */
export const REVIEW_MARK_ORDER: readonly InboxReviewState[] = [
  InboxReviewStates.NEW,
  InboxReviewStates.UPDATED,
  InboxReviewStates.IN_PROGRESS,
  InboxReviewStates.REVIEWED,
];
