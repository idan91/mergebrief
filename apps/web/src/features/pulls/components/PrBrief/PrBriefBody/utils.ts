import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";

import type { PrSummary } from "../../../types";
import {
  readSupersededStop,
  type SupersededStopSource,
} from "../../../utils/pr-state";
import { buildEmptyCopyOverride } from "../EmptyCard/utils";
import { SupersededStopAnnouncementKeys } from "./consts";

/** The meta fields the empty card's line reads. */
export type EmptyCopySource = Pick<PrSummary, "appInstalled" | "state">;

/** The empty card's line, for the card and its announcement alike. */
export function readEmptyCopyOverride(
  t: TFunction,
  meta: EmptyCopySource,
): string | undefined {
  return buildEmptyCopyOverride(t, {
    appInstalled: meta.appInstalled,
    prState: meta.state,
  });
}

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
