import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useAnnouncer } from "@web/hooks/useAnnouncer";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { generateBriefViaApi } from "../../../../../../brief/queries";
import { briefErrorDetail } from "../../../../../../brief/utils";
import { buildPrMetaQueryOptions } from "../../../../../queries";
import { draftPolicyNotice } from "../../../../../utils/ownDraft";
import { GenerationStatuses, type PrSummary } from "../../../../../types";
import type { BehindNoticeProps } from ".";

export interface BehindNoticeState {
  /** The last regenerate outcome, for the controls' persistent live region. */
  announcement: string;
  /** Present while GitHub has commits the latest brief does not cover. */
  notice?: BehindNoticeProps | undefined;
}

function isGenerationUnderway(meta: PrSummary): boolean {
  const status = meta.generation?.status;
  return (
    status === GenerationStatuses.PENDING ||
    status === GenerationStatuses.RUNNING
  );
}

/**
 * Regenerate goes through the paste path with the pull request's own URL;
 * every outcome, the arrival of the brief it asked for included, lands in
 * a region that outlives the notice, and the meta re-reads once the request
 * settles so the queued generation shows.
 */
export function useBehindNoticeFacade(
  meta: PrSummary,
  repoId: string,
  prNumber: number,
): BehindNoticeState {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { announce, text: announcement } = useAnnouncer();
  const awaitingBrief = useRef(false);
  const regenerate = useMutation({
    mutationFn: (url: string) => generateBriefViaApi(url),
    onSuccess: () => {
      awaitingBrief.current = true;
      announce(t("pulls.behind.queued"));
    },
    onError: (caught) => announce(briefErrorDetail(t, caught)),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: buildPrMetaQueryOptions(repoId, prNumber).queryKey,
      }),
  });

  useEffect(() => {
    if (meta.behind || !awaitingBrief.current) {
      return;
    }
    awaitingBrief.current = false;
    announce(t("pulls.behind.arrived"));
  }, [announce, meta.behind, t]);

  const state: BehindNoticeState = { announcement };
  if (!meta.behind) {
    return state;
  }

  const notice: BehindNoticeProps = {
    queued: isGenerationUnderway(meta),
    pending: regenerate.isPending,
  };
  if (notice.queued) {
    const policy = draftPolicyNotice(t, meta.draftPolicy, meta);
    if (policy?.kind === "damped") {
      notice.queuedNotice = policy.text;
    }
  }
  if (regenerate.isError) {
    notice.failure = briefErrorDetail(t, regenerate.error);
  }
  const url = buildGithubPullUrl(meta.repoSlug, prNumber);
  if (url !== null) {
    notice.onRegenerate = () => regenerate.mutate(url);
  }
  state.notice = notice;
  return state;
}
