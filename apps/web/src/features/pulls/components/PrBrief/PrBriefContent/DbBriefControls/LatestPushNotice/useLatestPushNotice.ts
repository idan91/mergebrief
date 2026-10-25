import { useTranslation } from "react-i18next";

import type { Mutable } from "types/utils";
import { useRegenerateBrief } from "../../../../../hooks/regenerate-brief/useRegenerateBrief";
import { RegenerateNotices } from "../../../../../hooks/regenerate-brief/utils";
import type { PrSummary } from "../../../../../types";
import type { LatestPushNoticeProps } from ".";
import { LatestPushNoticeKeys } from "./consts";
import { describeLatestPush, readLatestPushState } from "./utils";

export interface LatestPushNoticeState {
  /** The last run's outcome, for the controls' persistent live region. */
  announcement: string;
  /** Present while the latest push has no brief and an older one is on screen. */
  notice?: LatestPushNoticeProps | undefined;
}

/**
 * One notice for every state the latest push can sit in over a stored brief.
 * A failed push offers Regenerate and an awaiting one Generate, each under
 * its route's bar; both go through the one regenerate write.
 */
export function useLatestPushNotice(
  meta: PrSummary,
  repoId: string,
  prNumber: number,
): LatestPushNoticeState {
  const { t } = useTranslation();
  const latest = readLatestPushState(meta);
  const { pending, announcement, regenerate } = useRegenerateBrief({
    repoId,
    prNumber,
    notices:
      latest === undefined ? RegenerateNotices : LatestPushNoticeKeys[latest],
  });

  const state: LatestPushNoticeState = { announcement };
  const copy =
    latest === undefined ? undefined : describeLatestPush(t, meta, latest);
  if (copy === undefined) {
    return state;
  }
  const notice: Mutable<LatestPushNoticeProps> = {
    label: copy.label,
    title: copy.title,
    detail: copy.detail,
  };
  if (copy.actionLabels !== undefined) {
    notice.action = {
      pending,
      label: pending ? copy.actionLabels.pending : copy.actionLabels.action,
      onTrigger: regenerate,
    };
  }
  state.notice = notice;
  return state;
}
