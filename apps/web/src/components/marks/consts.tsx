import type { ReactNode } from "react";
import { InboxReviewStates, type InboxReviewState } from "types/inbox";

import InProgressMark from "./in-progress.svg?react";
import NewMark from "./new.svg?react";
import ReviewedMark from "./reviewed.svg?react";
import UpdatedMark from "./updated.svg?react";

/** Each review state's glyph, on the 14px grid; every consumer draws the same pairing. */
export const ReviewMarkGlyphs: Readonly<Record<InboxReviewState, ReactNode>> = {
  [InboxReviewStates.NEW]: <NewMark aria-hidden="true" />,
  [InboxReviewStates.IN_PROGRESS]: <InProgressMark aria-hidden="true" />,
  [InboxReviewStates.UPDATED]: <UpdatedMark aria-hidden="true" />,
  [InboxReviewStates.REVIEWED]: <ReviewedMark aria-hidden="true" />,
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
