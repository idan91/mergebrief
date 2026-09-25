import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { INBOX_QUERY_ROOT } from "../../consts";
import {
  deletePull,
  type DeletePullResult,
  type RowWriteFailureKind,
} from "../../queries";
import type { InboxItem } from "../../types";

/** The copy a refused delete announces, by the transport's failure kind. */
const DeleteFailureCopy = {
  forbidden: "home.inbox.actions.deleteForbidden",
  "not-found": "home.inbox.actions.deleteFailed",
  failed: "home.inbox.actions.deleteFailed",
} as const satisfies Record<RowWriteFailureKind, string>;

export interface InboxDeleteFacadeInput {
  /** The page-level live region. */
  readonly announce: (message: string) => void;
  /** At least one row is gone; the list decides where focus goes. */
  readonly onDeleted: () => void;
}

/**
 * The delete flow above the rows: a row (or a selection) asks, the modal
 * confirms, the transport runs, and the outcome is announced once. The
 * modal closes as soon as the transport answers; the inbox query is
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

  const confirm = useCallback(async (): Promise<void> => {
    const item = pending[0];
    if (item === undefined || busy) {
      return;
    }
    setBusy(true);
    const outcome = await deletePull(item.repoId, item.prNumber).catch(
      (): DeletePullResult => ({ kind: "failed" }),
    );
    setBusy(false);
    setPending([]);

    if (outcome.kind !== "deleted") {
      announce(t(DeleteFailureCopy[outcome.kind]));
      return;
    }
    onDeleted();
    announce(t("home.inbox.actions.deleted"));
    await queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
  }, [announce, busy, onDeleted, pending, queryClient, t]);

  return { pending, busy, requestDelete, cancel, confirm };
}
