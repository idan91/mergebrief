import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InboxArchivedFilters, type InboxArchivedFilter } from "types/inbox";

import { BULK_CONCURRENCY, INBOX_QUERY_ROOT } from "../../consts";
import { archivePull, unarchivePull } from "../../queries";
import {
  RowWriteResultKinds,
  type ArchivePullResult,
  type InboxItem,
} from "../../types";
import { runWithConcurrency } from "../../utils";
import { ArchiveScopes, type ArchiveScope } from "./types";
import { describeArchiveOutcome } from "./utils";

export interface UseInboxArchiveInput {
  readonly scope: ArchiveScope;
  /** The page-level live region. */
  readonly announce: (message: string) => void;
  /** Announces rows that went to the archive, where the caller offers a way back; else `announce`. */
  readonly announceArchived?: (
    message: string,
    gone: readonly InboxItem[],
  ) => void;
  /** Announces a restore that left rows archived a second try could bring back, where the caller offers it; else `announce`. */
  readonly announceRestoreFailed?: (
    message: string,
    failed: readonly InboxItem[],
  ) => void;
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
  readonly kind: ArchivePullResult["kind"];
}

/** A failure a second try could change; a missing row or a lost session stays as it is. */
const RETRYABLE_KINDS: ReadonlySet<ArchivePullResult["kind"]> = new Set([
  RowWriteResultKinds.FAILED,
  RowWriteResultKinds.INDETERMINATE,
]);

interface ArchiveRun {
  readonly gone: readonly InboxItem[];
  readonly retryable: readonly InboxItem[];
  /** A write got no answer, so its row may have moved. */
  readonly indeterminate: boolean;
}

async function archiveRows(
  items: readonly InboxItem[],
  restoring: boolean,
): Promise<ArchiveRun> {
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
        return { item, kind: outcome.kind };
      } catch {
        return { item, kind: RowWriteResultKinds.INDETERMINATE };
      }
    },
  );
  const gone = outcomes.filter((outcome) => outcome.kind === wanted);
  const retryable = outcomes.filter((outcome) =>
    RETRYABLE_KINDS.has(outcome.kind),
  );

  return {
    gone: gone.map((outcome) => outcome.item),
    retryable: retryable.map((outcome) => outcome.item),
    indeterminate: outcomes.some(
      (outcome) => outcome.kind === RowWriteResultKinds.INDETERMINATE,
    ),
  };
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
  announceArchived,
  announceRestoreFailed,
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
      const { gone, retryable, indeterminate } = await archiveRows(
        items,
        restoring,
      );
      if (scope === ArchiveScopes.SELECTION) {
        release(run);
      }

      const outcome = {
        // One row reads as a sentence, however it was selected.
        scope: items.length === 1 ? ArchiveScopes.ROW : scope,
        restoring,
        done: gone.length,
        total: items.length,
        indeterminate,
      };
      const message = describeArchiveOutcome(t, outcome);
      const offersUndo =
        !restoring && gone.length > 0 && announceArchived !== undefined;
      const offersUndoAgain =
        restoring &&
        retryable.length > 0 &&
        announceRestoreFailed !== undefined;
      if (offersUndo) {
        announceArchived(message, gone);
      } else if (offersUndoAgain) {
        announceRestoreFailed(message, retryable);
      } else {
        announce(message);
      }
      if (gone.length > 0) {
        onRemoved(gone);
      }
      const listMayHaveMoved = gone.length > 0 || indeterminate;
      if (listMayHaveMoved) {
        await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
      }
      return gone;
    } finally {
      release(run);
    }
  }

  return { pending, archive };
}
