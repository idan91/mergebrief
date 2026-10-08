import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { TFunction } from "i18next";
import { PullRequestSources } from "@web/features/pulls/types";
import { useTranslation } from "react-i18next";

import { BULK_CONCURRENCY, INBOX_QUERY_ROOT } from "../../consts";
import { deleteOwnPull, deletePull } from "../../queries";
import {
  RowWriteResultKinds,
  type InboxItem,
  type RowWriteFailureKind,
} from "../../types";
import { runWithConcurrency } from "../../utils";

/** The copy a refused delete announces, by the transport's failure kind. */
const DeleteFailureCopy = {
  [RowWriteResultKinds.FORBIDDEN]: "home.inbox.actions.deleteForbidden",
  [RowWriteResultKinds.NOT_FOUND]: "home.inbox.actions.deleteFailed",
  [RowWriteResultKinds.FAILED]: "home.inbox.actions.deleteFailed",
} as const satisfies Record<RowWriteFailureKind, string>;

export interface InboxDeleteFacadeInput {
  /** The page-level live region. */
  readonly announce: (message: string) => void;
  /** The rows that went, before the re-read; the list unticks them and decides where focus goes. */
  readonly onDeleted: (gone: readonly InboxItem[]) => void;
}

interface RowOutcome {
  readonly item: InboxItem;
  readonly kind: RowWriteFailureKind | typeof RowWriteResultKinds.DELETED;
}

/** A pasted row goes through the owner-only purge, which needs no GitHub read; an installation row through the gate. */
async function deleteRow(item: InboxItem): Promise<RowOutcome> {
  const remove =
    item.source === PullRequestSources.URL ? deleteOwnPull : deletePull;
  try {
    const outcome = await remove(item.repoId, item.prNumber);
    return { item, kind: outcome.kind };
  } catch {
    return { item, kind: RowWriteResultKinds.FAILED };
  }
}

/** One line for the live region: the single row's fate, or the tally. */
function describeOutcome(
  t: TFunction,
  outcomes: readonly RowOutcome[],
  failedCount: number,
): string {
  const single = outcomes[0];
  if (outcomes.length === 1 && single !== undefined) {
    return single.kind === RowWriteResultKinds.DELETED
      ? t("home.inbox.actions.deleted")
      : t(DeleteFailureCopy[single.kind]);
  }
  const deleted = outcomes.length - failedCount;
  if (failedCount === 0) {
    return t("home.inbox.actions.deletedMany", { count: deleted });
  }
  return t("home.inbox.actions.deletedSome", {
    done: deleted,
    total: outcomes.length,
    failed: failedCount,
  });
}

/**
 * The delete flow above the rows: a row (or a selection) asks, the modal
 * confirms, the transport runs four at a time, and the outcome is announced
 * once. The modal closes as soon as every answer is in; the inbox query is
 * re-read after that, and only when a row actually went.
 */
export function useInboxDeleteFacade({
  announce,
  onDeleted,
}: InboxDeleteFacadeInput) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<readonly InboxItem[]>([]);
  const [busy, setBusy] = useState(false);

  const requestDelete = useCallback((items: readonly InboxItem[]): void => {
    setPending(items);
  }, []);

  const cancel = useCallback((): void => {
    setPending([]);
  }, []);

  /** Runs the delete over every pending row; answers the rows that went. */
  const confirm = useCallback(async (): Promise<readonly InboxItem[]> => {
    if (pending.length === 0 || busy) {
      return [];
    }
    setBusy(true);
    const outcomes = await runWithConcurrency(
      pending,
      BULK_CONCURRENCY,
      deleteRow,
    );
    setBusy(false);
    setPending([]);

    const gone = outcomes
      .filter((outcome) => outcome.kind === RowWriteResultKinds.DELETED)
      .map((outcome) => outcome.item);
    announce(describeOutcome(t, outcomes, outcomes.length - gone.length));
    if (gone.length > 0) {
      onDeleted(gone);
      await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
    }
    return gone;
  }, [announce, busy, onDeleted, pending, queryClient, t]);

  return { pending, busy, requestDelete, cancel, confirm };
}
