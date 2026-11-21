import {
  RegenerateResultKinds,
  type RegenerateNoticeKeys,
} from "../../../../../../types";
import { RegenerateNotices } from "../../../../../../hooks/regenerate-brief/utils";
import { HeldGenerateNotices } from "../../../../../../consts";
import { GenerateNotices } from "../../../../trigger-offer";
import { LatestPushStates, type LatestPushState } from "./types";

/** The chip turns to generating once the run is queued, so its region says so. */
export const FailedPushNotices: RegenerateNoticeKeys = {
  ...RegenerateNotices,
  [RegenerateResultKinds.QUEUED]: "pulls.newerCommits.announce.queued",
};

/** The chip turns to generating once the run is queued, so its region says so. */
export const OnDemandNotices: RegenerateNoticeKeys = {
  ...GenerateNotices,
  [RegenerateResultKinds.QUEUED]: "pulls.newerCommits.announce.queued",
};

/** The chip turns to generating once the run is queued, so its region says so. */
export const HeldPushNotices: RegenerateNoticeKeys = {
  ...HeldGenerateNotices,
  [RegenerateResultKinds.QUEUED]: "pulls.newerCommits.announce.queued",
};

/** A generating, stalled or capped push offers no run, so its entry is never read. */
export const LatestPushRunNotices: Record<
  LatestPushState,
  RegenerateNoticeKeys
> = {
  [LatestPushStates.FAILED]: FailedPushNotices,
  [LatestPushStates.AWAITING_TRIGGER]: OnDemandNotices,
  [LatestPushStates.GENERATING]: RegenerateNotices,
  [LatestPushStates.STALLED]: RegenerateNotices,
  [LatestPushStates.CAPPED]: RegenerateNotices,
  [LatestPushStates.HELD]: HeldPushNotices,
};
