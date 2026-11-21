import { useTranslation } from "react-i18next";

import { useRegenerateBrief } from "../../../hooks/regenerate-brief/useRegenerateBrief";
import type { FailedCardProps } from ".";
import {
  buildFailedNote,
  buildFailureLine,
  readOffersRegenerate,
} from "../failed-head";

export function useFailedCardFacade({
  errorCode,
  errorDetail,
  attempts,
  repoId,
  prNumber,
  viewerCanPush,
  appInstalled,
  prState,
}: FailedCardProps) {
  const { t } = useTranslation();
  const { pending, announcement, regenerate } = useRegenerateBrief({
    repoId,
    prNumber,
  });

  const offersRegenerate = readOffersRegenerate({
    errorCode,
    viewerCanPush,
    appInstalled,
    prState,
  });

  return {
    detail: buildFailureLine(t, errorCode, errorDetail),
    note: buildFailedNote(t, {
      errorCode,
      attempts,
      offersRegenerate,
      prState,
      appInstalled,
    }),
    pending,
    announcement,
    onRegenerate: offersRegenerate ? regenerate : undefined,
  };
}
