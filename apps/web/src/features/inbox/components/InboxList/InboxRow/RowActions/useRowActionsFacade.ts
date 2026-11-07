import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InboxArchivedFilter } from "types/inbox";

import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { generateBriefViaApi } from "../../../../../brief/queries";
import { briefErrorDetail } from "../../../../../brief/model";
import { INBOX_QUERY_ROOT } from "../../../../consts";
import type { InboxItem } from "../../../../types";
import { ArchiveScopes } from "../../types";
import { useInboxArchive } from "../../useInboxArchive";

/** The row actions with a side effect: the clipboard write, the archive either way, and the regenerate. */
export function useRowActionsFacade(
  item: InboxItem,
  view: InboxArchivedFilter,
  href: string,
  onAnnounce: (message: string) => void,
  onRemoved: () => void,
  onArchived: (message: string, gone: readonly InboxItem[]) => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const archiving = useInboxArchive({
    scope: ArchiveScopes.ROW,
    announce: onAnnounce,
    announceArchived: onArchived,
    onRemoved,
  });

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
    if (url === undefined) {
      return;
    }
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
    archiving: archiving.pending,
    regenerating,
    copyLink: () => {
      void copyLink();
    },
    toggleArchive: () => {
      void archiving.archive([item], view);
    },
    regenerate: () => {
      void regenerate();
    },
  };
}
