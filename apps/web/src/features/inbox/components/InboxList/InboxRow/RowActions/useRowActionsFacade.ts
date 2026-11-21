import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InboxArchivedFilter } from "types/inbox";

import {
  useGenerateEveryPush,
  useRegenerateBrief,
} from "@web/features/pulls/hooks";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { generateBriefViaApi } from "../../../../../brief/queries";
import { briefErrorDetail } from "../../../../../brief/model";
import { INBOX_QUERY_ROOT } from "../../../../consts";
import type { InboxItem } from "../../../../types";
import { ArchiveScopes } from "../../types";
import { useInboxArchive } from "../../useInboxArchive";
import { HeldRowGenerateNotices } from "./consts";

const INBOX_QUERY_KEY = [INBOX_QUERY_ROOT];

/** The row actions with a side effect: the clipboard write, the archive either way, the regenerate, Generate brief on a held head, and the every-push switch. */
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
  const generateBrief = useRegenerateBrief({
    repoId: item.repoId,
    prNumber: item.prNumber,
    notices: HeldRowGenerateNotices,
    announce: onAnnounce,
    alsoInvalidates: INBOX_QUERY_KEY,
  });
  const everyPush = useGenerateEveryPush({
    repoId: item.repoId,
    prNumber: item.prNumber,
    on: item.generateEveryPush,
    announce: onAnnounce,
    alsoInvalidates: INBOX_QUERY_KEY,
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
      await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    } catch (caught) {
      onAnnounce(briefErrorDetail(t, caught));
    } finally {
      setRegenerating(false);
    }
  }

  return {
    archiving: archiving.pending,
    regenerating,
    generating: generateBrief.pending,
    generate: generateBrief.regenerate,
    everyPushOn: everyPush.checked,
    everyPushPending: everyPush.pending,
    toggleEveryPush: () => {
      everyPush.setOn(!everyPush.checked);
    },
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
