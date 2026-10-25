import {
  RegenerateResultKinds,
  type RegenerateNoticeKeys,
} from "../../../../../types";
import { RegenerateNotices } from "../../../../../hooks/regenerate-brief/utils";

/** The notice leaves once the rerun is queued, so its region says so. */
export const FailedPushNotices: RegenerateNoticeKeys = {
  ...RegenerateNotices,
  [RegenerateResultKinds.QUEUED]: "pulls.latestPush.failed.queued",
};
