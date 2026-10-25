import {
  RegenerateResultKinds,
  type RegenerateNoticeKeys,
} from "../../../../../types";
import { RegenerateNotices } from "../../../../../hooks/regenerate-brief/utils";
import { GenerateNotices } from "../../../trigger-offer";
import { LatestPushStates, type LatestPushState } from "./types";

/** The notice leaves once the run is queued, so its region says so. */
export const FailedPushNotices: RegenerateNoticeKeys = {
  ...RegenerateNotices,
  [RegenerateResultKinds.QUEUED]: "pulls.latestPush.failed.queued",
};

/** The notice leaves once the run is queued, so its region says so. */
export const OnDemandNotices: RegenerateNoticeKeys = {
  ...GenerateNotices,
  [RegenerateResultKinds.QUEUED]: "pulls.awaitingTrigger.notice.queued",
};

/** A generating or capped push offers no run, so its entry is never read. */
export const LatestPushNoticeKeys: Record<
  LatestPushState,
  RegenerateNoticeKeys
> = {
  [LatestPushStates.FAILED]: FailedPushNotices,
  [LatestPushStates.AWAITING_TRIGGER]: OnDemandNotices,
  [LatestPushStates.GENERATING]: RegenerateNotices,
  [LatestPushStates.CAPPED]: RegenerateNotices,
};
