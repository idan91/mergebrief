import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Mutable } from "types/utils";

import { useAnnouncer } from "@web/hooks/useAnnouncer";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { generateBriefViaApi } from "../../../../../../../brief/queries";
import { briefErrorDetail } from "../../../../../../../brief/model";
import { buildPrMetaQueryOptions } from "../../../../../../queries";
import type { PrSummary } from "../../../../../../types";
import { useArrivalAnnouncement } from "../../../../../../hooks/regenerate-brief/useArrivalAnnouncement";
import type { PasteRun } from "../types";

export interface PasteRegenerate extends PasteRun {
  /** The last paste outcome, for the controls' persistent live region. */
  readonly announcement: string;
}

/**
 * A url row's run goes through the paste path with the pull request's own
 * URL; an installation row gets no trigger. Every outcome, the arrival of
 * the brief it asked for included, lands in a region that outlives the
 * chip, and the meta re-reads once the request settles so the queued
 * generation shows. A paste briefs the base and head GitHub names, so it has
 * arrived once that span is briefed and GitHub is not ahead of it.
 */
export function usePasteRegenerate(
  meta: PrSummary,
  repoId: string,
  prNumber: number,
): PasteRegenerate {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { announce, text: announcement } = useAnnouncer();
  const githubSpanBriefed = meta.briefAvailable && !meta.behind;
  const markQueued = useArrivalAnnouncement(
    {
      arrived: githubSpanBriefed,
      notice: "pulls.newerCommits.announce.arrived",
    },
    announce,
  );
  const regenerate = useMutation({
    mutationFn: (url: string) => generateBriefViaApi(url),
    onSuccess: () => {
      markQueued();
      announce(t("pulls.newerCommits.announce.queued"));
    },
    onError: (caught) => announce(briefErrorDetail(t, caught)),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: buildPrMetaQueryOptions(repoId, prNumber).queryKey,
      }),
  });

  const paste: Mutable<PasteRegenerate> = {
    announcement,
    pending: regenerate.isPending,
  };
  if (regenerate.isError) {
    paste.failure = briefErrorDetail(t, regenerate.error);
  }
  const url = buildGithubPullUrl(meta.repoSlug, prNumber);
  const pasteable = url !== undefined && !meta.appInstalled;
  if (pasteable) {
    paste.trigger = () => regenerate.mutate(url);
  }
  return paste;
}
