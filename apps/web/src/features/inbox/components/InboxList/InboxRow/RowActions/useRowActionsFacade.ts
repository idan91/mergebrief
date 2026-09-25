import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { generateBriefViaApi } from "../../../../../brief/queries";
import { briefErrorDetail } from "../../../../../brief/utils";
import { INBOX_QUERY_ROOT } from "../../../../consts";
import type { InboxItem } from "../../../../types";

/** The row actions with a side effect: the clipboard write and the regenerate. */
export function useRowActionsFacade(
  item: InboxItem,
  href: string,
  onAnnounce: (message: string) => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      onAnnounce(t("home.inbox.actions.linkCopied"));
    } catch {
      onAnnounce(t("home.inbox.actions.copyFailed"));
    }
  }

  async function regenerate(): Promise<void> {
    const url = buildGithubPullUrl(item.repoSlug, item.prNumber);
    if (url === null) return;
    setRegenerating(true);
    try {
      await generateBriefViaApi(url);
      onAnnounce(t("home.inbox.actions.regenerateQueued"));
      await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
    } catch (caught) {
      onAnnounce(briefErrorDetail(t, caught));
    } finally {
      setRegenerating(false);
    }
  }

  return {
    regenerating,
    copyLink: () => {
      void copyLink();
    },
    regenerate: () => {
      void regenerate();
    },
  };
}
