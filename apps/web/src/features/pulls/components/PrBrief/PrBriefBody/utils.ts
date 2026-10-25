import type { TranslationKey } from "i18n";

import {
  readSupersededStop,
  type SupersededStopSource,
} from "../../../utils/pr-state";
import { SupersededStopAnnouncementKeys } from "./consts";

/** The superseded announcement: the stop that ends the run, else a newer push on its way. */
export function readSupersededAnnouncementKey(
  meta: SupersededStopSource,
): TranslationKey {
  const stop = readSupersededStop(meta);
  if (stop === undefined) {
    return "pulls.announce.superseded";
  }
  return SupersededStopAnnouncementKeys[stop];
}
