import { useTranslation } from "react-i18next";

import { useRegenerateBrief } from "../../../hooks/regenerate-brief/useRegenerateBrief";
import { isNoLongerOpen } from "../../../utils/pr-state";
import { readHeldLead, splitUnmetConditions } from "../held-head";
import { HeldGenerateNotices } from "../held-head/consts";
import { readOffersTrigger } from "../trigger-offer";
import type { HeldCardProps } from ".";
import type { HeldCardFacade } from "./types";

export function useHeldCardFacade({
  repoId,
  prNumber,
  unmetConditions,
  unmetConditionsPartial,
  viewerCanPush,
  appInstalled,
  prState,
}: HeldCardProps): HeldCardFacade {
  const { t } = useTranslation();
  const { pending, announcement, regenerate } = useRegenerateBrief({
    repoId,
    prNumber,
    notices: HeldGenerateNotices,
  });

  const offersGenerate = readOffersTrigger({
    prState,
    viewerCanPush,
    appInstalled,
  });
  const noLongerOpen = isNoLongerOpen(prState);
  const lead = noLongerOpen
    ? t("pulls.awaitingTrigger.notOpenCopy")
    : readHeldLead(
        t,
        splitUnmetConditions(unmetConditions),
        unmetConditionsPartial,
      );

  return {
    lead,
    showsConditions: !noLongerOpen,
    pending,
    announcement,
    onGenerate: offersGenerate ? regenerate : undefined,
  };
}
