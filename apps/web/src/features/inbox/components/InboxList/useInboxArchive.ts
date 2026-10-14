import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InboxArchivedFilters, type InboxArchivedFilter } from "types/inbox";

import { BULK_CONCURRENCY, INBOX_QUERY_ROOT } from "../../consts";
import { archivePull, unarchivePull } from "../../queries";
import { RowWriteResultKinds, type InboxItem } from "../../types";
import { runWithConcurrency } from "../../utils";
import { ArchiveScopes, type ArchiveScope } from "./types";
import { describeArchiveOutcome } from "./utils";

export interface UseInboxArchiveInput {
  readonly scope: ArchiveScope;
  /** The page-level live region. */
  readonly announce: (message: string) => void;
  /** The rows that went, before the re-read; the caller unticks them and decides where focus goes. */
  readonly onRemoved: (gone: readonly InboxItem[]) => void;
}

export interface UseInboxArchiveValue {
  readonly pending: boolean;
  /** Archive (or unarchive, in the archived view) every row; answers the rows that went. */
  readonly archive: (
    items: readonly InboxItem[],
    view: InboxArchivedFilter,
  ) => Promise<readonly InboxItem[]>;
}

interface RowOutcome {
  readonly item: InboxItem;
  readonly done: boolean;
}

async function archiveRows(
  items: readonly InboxItem[],
  restoring: boolean,
): Promise<readonly InboxItem[]> {
  const write = restoring ? unarchivePull : archivePull;
  const wanted = restoring
    ? RowWriteResultKinds.UNARCHIVED
    : RowWriteResultKinds.ARCHIVED;
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
  return outcomes
    .filter((outcome) => outcome.done)
    .map((outcome) => outcome.item);
}

/**
 * The one archive flow, for a row's menu (a one-row selection) and the
 * selection bar: four requests at a time, one announcement, one re-read.
 * A row's action stays held until the re-read lands; the selection bar is
 * free again as soon as every answer is in.
 */
export function useInboxArchive({
  scope,
  announce,
  onRemoved,
}: UseInboxArchiveInput): UseInboxArchiveValue {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef<symbol | undefined>(undefined);

  function release(run: symbol): void {
    if (inFlight.current !== run) {
      return;
    }
    inFlight.current = undefined;
    setPending(false);
  }

  async function archive(
    items: readonly InboxItem[],
    view: InboxArchivedFilter,
  ): Promise<readonly InboxItem[]> {
    const cannotStart = items.length === 0 || inFlight.current !== undefined;
    if (cannotStart) {
      return [];
    }
    const restoring = view === InboxArchivedFilters.ONLY;
    const run = Symbol("archive-run");
    inFlight.current = run;
    setPending(true);

    try {
      const gone = await archiveRows(items, restoring);
      if (scope === ArchiveScopes.SELECTION) {
        release(run);
      }

      const outcome = {
        scope,
        restoring,
        done: gone.length,
        total: items.length,
      };
      announce(describeArchiveOutcome(t, outcome));
      if (gone.length > 0) {
        onRemoved(gone);
        await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
      }
      return gone;
    } finally {
      release(run);
    }
  }

  return { pending, archive };
}
