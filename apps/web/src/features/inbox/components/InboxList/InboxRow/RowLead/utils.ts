import type { TFunction } from "i18next";
import type { InboxReviewState } from "types/inbox";

import { ReviewMarkLabelKeys } from "@web/components/ReviewMark/consts";
import { UnknownValues, type UnknownValue } from "@web/utils/open-enum/types";

/** The lead slot's callout for a row's review state; an unknown state has none. */
export function readReviewStateTip(
  t: TFunction,
  reviewState: InboxReviewState | UnknownValue | undefined,
): string | undefined {
  if (reviewState === UnknownValues.UNKNOWN) {
    return undefined;
  }
  if (reviewState === undefined) {
    return t("shell.marks.yoursTip");
  }
  return t(ReviewMarkLabelKeys[reviewState]);
}
