import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";

import type { PrSummary } from "../../../types";
import { awaitsReadyForReview } from "../../../utils/draft-policy";
import { draftPolicyNotice } from "../../../utils/ownDraft";
import {
  readSupersededStop,
  type SupersededStopSource,
} from "../../../utils/pr-state";
import { buildEmptyCopyOverride } from "../EmptyCard/utils";
import { SupersededStopAnnouncementKeys } from "./consts";

/** The meta fields the empty card's line reads. */
export type EmptyCopySource = Pick<
  PrSummary,
  "appInstalled" | "state" | "draft" | "draftPolicy" | "viewerIsAuthor"
>;

/** The empty card's line, for the card and its announcement alike. */
export function readEmptyCopyOverride(
  t: TFunction,
  meta: EmptyCopySource,
): string | undefined {
  const notice = draftPolicyNotice(t, meta.draftPolicy, meta);
  const draftsOffNotice =
    notice?.kind === "drafts-off" ? notice.text : undefined;
  return buildEmptyCopyOverride(t, {
    appInstalled: meta.appInstalled,
    prState: meta.state,
    awaitsReadyForReview: awaitsReadyForReview(meta),
    draftsOffNotice,
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
