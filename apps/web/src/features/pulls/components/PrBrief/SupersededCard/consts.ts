import type { TranslationKey } from "i18n";

import { SupersededStops, type SupersededStop } from "../../../types";

/** What comes next once the run stopped for good. */
export const StopNoteKeys: Record<SupersededStop, TranslationKey> = {
  [SupersededStops.CLOSED]: "pulls.failed.notOpenNote",
  [SupersededStops.READY_FOR_REVIEW]: "pulls.failed.readyForReviewNote",
};
