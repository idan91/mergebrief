import type { ReactNode } from "react";
import { InboxReviewStates, type InboxReviewState } from "types/inbox";

import { Icon } from "../Icon/Icon";
import { IconSizes, type IconSize } from "../Icon/types";
import { ReviewMarkIconNames } from "./consts";

export interface ReviewMarkProps {
  state: InboxReviewState;
  size?: IconSize;
}

/** The review state's mark, drawn from the set; decorative, the row or legend names the state. */
export function ReviewMark({ state, size = IconSizes.MD }: ReviewMarkProps) {
  return <Icon name={ReviewMarkIconNames[state]} size={size} />;
}

/** The marks at control size, for a menu or a legend that lists them. */
export const ReviewMarkGlyphs: Readonly<Record<InboxReviewState, ReactNode>> = {
  [InboxReviewStates.NEW]: <ReviewMark state={InboxReviewStates.NEW} />,
  [InboxReviewStates.IN_PROGRESS]: (
    <ReviewMark state={InboxReviewStates.IN_PROGRESS} />
  ),
  [InboxReviewStates.UPDATED]: <ReviewMark state={InboxReviewStates.UPDATED} />,
  [InboxReviewStates.REVIEWED]: (
    <ReviewMark state={InboxReviewStates.REVIEWED} />
  ),
};
