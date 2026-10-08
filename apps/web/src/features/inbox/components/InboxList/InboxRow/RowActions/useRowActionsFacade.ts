import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { generateBriefViaApi } from "../../../../../brief/queries";
import { briefErrorDetail } from "../../../../../brief/utils";
import { INBOX_QUERY_ROOT } from "../../../../consts";
import { archivePull, unarchivePull } from "../../../../queries";
import { RowWriteResultKinds, type InboxItem } from "../../../../types";

/** The row actions with a side effect: the clipboard write, the archive either way, and the regenerate. */
export function useRowActionsFacade(
  item: InboxItem,
  href: string,
  onAnnounce: (message: string) => void,
  onRemoved: () => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function archiveRow(): Promise<void> {
    setArchiving(true);
    try {
      const outcome = await archivePull(item.repoId, item.prNumber);
      if (outcome.kind !== RowWriteResultKinds.ARCHIVED) {
        onAnnounce(t("home.inbox.actions.archiveFailed"));
        return;
      }
      onRemoved();
      onAnnounce(t("home.inbox.actions.archived"));
      await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
    } catch {
      onAnnounce(t("home.inbox.actions.archiveFailed"));
    } finally {
      setArchiving(false);
    }
  }

  async function unarchiveRow(): Promise<void> {
    setArchiving(true);
    try {
      const outcome = await unarchivePull(item.repoId, item.prNumber);
      if (outcome.kind !== RowWriteResultKinds.UNARCHIVED) {
        onAnnounce(t("home.inbox.actions.unarchiveFailed"));
        return;
      }
      onRemoved();
      onAnnounce(t("home.inbox.actions.unarchived"));
      await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
    } catch {
      onAnnounce(t("home.inbox.actions.unarchiveFailed"));
    } finally {
      setArchiving(false);
    }
  }

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
    if (url === null) {
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
    archiving,
    regenerating,
    copyLink: () => {
      void copyLink();
    },
    archiveRow: () => {
      void archiveRow();
    },
    unarchiveRow: () => {
      void unarchiveRow();
    },
    regenerate: () => {
      void regenerate();
    },
  };
}
