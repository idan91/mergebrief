import { useTranslation } from "react-i18next";

import { useGenerateEveryPush } from "../../../hooks/generate-every-push/useGenerateEveryPush";
import { useRegenerateBrief } from "../../../hooks/regenerate-brief/useRegenerateBrief";
import { isNoLongerOpen } from "../../../utils/pr-state";
import { splitUnmetConditions } from "@web/utils/unmet-conditions";
import { readHeldLead } from "../held-head";
import { HeldGenerateNotices } from "../../../consts";
import { readOffersTrigger } from "../trigger-offer";
import type { HeldCardProps } from ".";

export function useHeldCardFacade({
  repoId,
  prNumber,
  unmetConditions,
  unmetConditionsPartial,
  onAnnounce,
  viewerCanPush,
  appInstalled,
  prState,
  generateEveryPush,
}: HeldCardProps) {
  const { t } = useTranslation();
  const { pending, announcement, regenerate } = useRegenerateBrief({
    repoId,
    prNumber,
    notices: HeldGenerateNotices,
  });
  const everyPush = useGenerateEveryPush({
    repoId,
    prNumber,
    on: generateEveryPush,
    announce: onAnnounce,
  });

  const offersGenerate = readOffersTrigger({
    prState,
    viewerCanPush,
    appInstalled,
  });
  const noLongerOpen = isNoLongerOpen(prState);
  const heading = noLongerOpen
    ? t("pulls.held.notOpenHeading")
    : t("pulls.held.heading");
  const lead = noLongerOpen
    ? t("pulls.held.lead.notOpen")
    : readHeldLead(
        t,
        splitUnmetConditions(unmetConditions),
        unmetConditionsPartial,
      );

  return {
    heading,
    lead,
    showsConditions: !noLongerOpen,
    pending,
    announcement,
    onGenerate: offersGenerate ? regenerate : undefined,
    everyPush: offersGenerate ? everyPush : undefined,
  };
}
