import type { TranslationKey } from "i18n";

import { SupersededStops, type SupersededStop } from "../../../types";

/** What the region says once a superseded run has nothing after it. */
export const SupersededStopAnnouncementKeys: Record<
  SupersededStop,
  TranslationKey
> = {
  [SupersededStops.CLOSED]: "pulls.announce.supersededNotOpen",
  [SupersededStops.READY_FOR_REVIEW]: "pulls.announce.supersededReadyForReview",
};
