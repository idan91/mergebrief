import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { InboxArchivedFilters, type InboxArchivedFilter } from "types/inbox";

import { BULK_CONCURRENCY, INBOX_QUERY_ROOT } from "../../consts";
import { archivePull, unarchivePull } from "../../queries";
import { RowWriteResultKinds, type InboxItem } from "../../types";
import { runWithConcurrency } from "../../utils";

export interface InboxArchiveFacadeInput {
  readonly announce: (message: string) => void;
  /** The rows that went, before the re-read; the list unticks them and decides where focus goes. */
  readonly onRemoved: (gone: readonly InboxItem[]) => void;
}

interface RowOutcome {
  readonly item: InboxItem;
  readonly done: boolean;
}

/** The bulk archive: four requests at a time, one tally, one re-read. */
export function useInboxArchiveFacade({
  announce,
  onRemoved,
}: InboxArchiveFacadeInput) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  /** Archive (or unarchive, in the archived view) every row; answers the rows that went. */
  async function archiveMany(
    items: readonly InboxItem[],
    view: InboxArchivedFilter,
  ): Promise<readonly InboxItem[]> {
    if (items.length === 0 || busy) {
      return [];
    }
    const restoring = view === InboxArchivedFilters.ONLY;
    const write = restoring ? unarchivePull : archivePull;
    const wanted = restoring
      ? RowWriteResultKinds.UNARCHIVED
      : RowWriteResultKinds.ARCHIVED;
    setBusy(true);
    const outcomes = await runWithConcurrency(
      items,
      BULK_CONCURRENCY,
      async (item): Promise<RowOutcome> => {
        try {
          const outcome = await write(item.repoId, item.prNumber);
          return { item, done: outcome.kind === wanted };
        } catch {
          return { item, done: false };
        }
      },
    );
    setBusy(false);

    const gone = outcomes
      .filter((outcome) => outcome.done)
      .map((outcome) => outcome.item);
    const failed = outcomes.length - gone.length;
    if (failed === 0) {
      announce(
        restoring
          ? t("home.inbox.actions.unarchivedMany", { count: gone.length })
          : t("home.inbox.actions.archivedMany", { count: gone.length }),
      );
    } else {
      const tally = { done: gone.length, total: outcomes.length, failed };
      announce(
        restoring
          ? t("home.inbox.actions.unarchivedSome", tally)
          : t("home.inbox.actions.archivedSome", tally),
      );
    }
    if (gone.length > 0) {
      onRemoved(gone);
      await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
    }
    return gone;
  }

  return { busy, archiveMany };
}
