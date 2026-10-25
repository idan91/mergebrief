import { useTranslation } from "react-i18next";

import { useRegenerateBrief } from "../../../hooks/regenerate-brief/useRegenerateBrief";
import { isNoLongerOpen } from "../../../utils/pr-state";
import { GenerateNotices, readOffersTrigger } from "../trigger-offer";
import type { AwaitingTriggerCardProps } from ".";
import { readAwaitingDetailKey } from "../awaiting-head";

export function useAwaitingTriggerCardFacade({
  repoId,
  prNumber,
  viewerCanPush,
  appInstalled,
  prState,
  awaitsReadyForReview,
}: AwaitingTriggerCardProps) {
  const { t } = useTranslation();
  const { pending, announcement, regenerate } = useRegenerateBrief({
    repoId,
    prNumber,
    notices: GenerateNotices,
  });

  const offersGenerate = readOffersTrigger({
    prState,
    viewerCanPush,
    appInstalled,
  });

  const noLongerOpen = isNoLongerOpen(prState);
  return {
    heading: noLongerOpen
      ? t("pulls.awaitingTrigger.notOpenHeading")
      : t("pulls.awaitingTrigger.heading"),
    detail: t(readAwaitingDetailKey({ noLongerOpen, awaitsReadyForReview })),
    pending,
    announcement,
    onGenerate: offersGenerate ? regenerate : undefined,
  };
}
