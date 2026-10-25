import { useTranslation } from "react-i18next";

import type { Mutable } from "types/utils";
import { useRegenerateBrief } from "../../../../../hooks/regenerate-brief/useRegenerateBrief";
import type { PrSummary } from "../../../../../types";
import { awaitsReadyForReview } from "../../../../../utils/draft-policy";
import { readOffersRegenerate } from "../../../failed-head";
import type { LatestPushNoticeProps } from ".";
import { FailedPushNotices } from "./consts";
import { LatestPushStates } from "./types";
import {
  buildCappedPushDetail,
  buildFailedPushDetail,
  readLatestPushState,
} from "./utils";

export interface LatestPushNoticeState {
  /** The last rerun outcome, for the controls' persistent live region. */
  announcement: string;
  /** Present while the latest push has no brief and an older one is on screen. */
  notice?: LatestPushNoticeProps | undefined;
}

export function useLatestPushNotice(
  meta: PrSummary,
  repoId: string,
  prNumber: number,
): LatestPushNoticeState {
  const { t } = useTranslation();
  const { pending, announcement, regenerate } = useRegenerateBrief({
    repoId,
    prNumber,
    notices: FailedPushNotices,
  });

  const state: LatestPushNoticeState = { announcement };
  const heldForReady = awaitsReadyForReview(meta);
  const latest = readLatestPushState(meta);
  const { generation } = meta;
  if (latest === undefined || generation === undefined) {
    return state;
  }
  if (latest === LatestPushStates.GENERATING) {
    state.notice = {
      label: t("pulls.latestPush.generating.label"),
      title: t("pulls.latestPush.generating.title"),
    };
    return state;
  }
  if (latest === LatestPushStates.CAPPED) {
    state.notice = {
      label: t("pulls.latestPush.capped.label"),
      title: t("pulls.latestPush.capped.title"),
      detail: buildCappedPushDetail(t, {
        cappedAt: generation.updatedAt,
        prState: meta.state,
        appInstalled: meta.appInstalled,
        awaitsReadyForReview: heldForReady,
      }),
    };
    return state;
  }

  const offersRegenerate = readOffersRegenerate({
    errorCode: generation.errorCode,
    viewerCanPush: meta.viewerCanPush,
    appInstalled: meta.appInstalled,
    prState: meta.state,
  });
  const notice: Mutable<LatestPushNoticeProps> = {
    label: t("pulls.latestPush.failed.label"),
    title: t("pulls.latestPush.failed.title"),
    detail: buildFailedPushDetail(t, {
      generation,
      offersRegenerate,
      prState: meta.state,
      appInstalled: meta.appInstalled,
      awaitsReadyForReview: heldForReady,
    }),
  };
  if (offersRegenerate) {
    notice.action = {
      pending,
      label: pending
        ? t("pulls.failed.regenerate.pending")
        : t("pulls.failed.regenerate.action"),
      onTrigger: regenerate,
    };
  }
  state.notice = notice;
  return state;
}
