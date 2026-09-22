import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { generateBriefViaApi } from "../../../../../brief/queries";
import { briefErrorDetail } from "../../../../../brief/utils";
import { INBOX_QUERY_ROOT } from "../../../../consts";
import { deleteInboxItem } from "../../../../queries";
import type { InboxItem } from "../../../../types";

/** The row actions with a side effect: the clipboard write, the owner delete, and the regenerate. */
export function useRowActionsFacade(
  item: InboxItem,
  href: string,
  onAnnounce: (message: string) => void,
  onDeleted: () => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      onAnnounce(t("home.inbox.actions.linkCopied"));
    } catch {
      onAnnounce(t("home.inbox.actions.copyFailed"));
    }
  }

  async function deleteRow(): Promise<void> {
    setDeleting(true);
    try {
      const deleted = await deleteInboxItem(item.repoId, item.prNumber);
      if (!deleted) {
        onAnnounce(t("home.inbox.actions.deleteFailed"));
        return;
      }
      onDeleted();
      onAnnounce(t("home.inbox.actions.deleted"));
      await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
    } catch {
      onAnnounce(t("home.inbox.actions.deleteFailed"));
    } finally {
      setDeleting(false);
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
    deleting,
    regenerating,
    copyLink: () => {
      void copyLink();
    },
    deleteRow: () => {
      void deleteRow();
    },
    regenerate: () => {
      void regenerate();
    },
  };
}
