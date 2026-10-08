import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { purgeAttachments } from "../../queries";
import {
  RowWriteResultKinds,
  type InboxItem,
  type PurgeAttachmentsResult,
} from "../../types";

type PurgeOutcome = PurgeAttachmentsResult["kind"];

/** The copy each outcome announces. */
const PurgeOutcomeCopy = {
  [RowWriteResultKinds.PURGED]: "home.inbox.actions.purged",
  [RowWriteResultKinds.DISABLED]: "home.inbox.actions.purgeDisabled",
  [RowWriteResultKinds.APP_PERMISSION]: "home.inbox.actions.purgeAppPermission",
  [RowWriteResultKinds.FORBIDDEN]: "home.inbox.actions.purgeForbidden",
  [RowWriteResultKinds.NOT_FOUND]: "home.inbox.actions.purgeFailed",
  [RowWriteResultKinds.FAILED]: "home.inbox.actions.purgeFailed",
} as const satisfies Record<PurgeOutcome, string>;

export interface InboxPurgeFacadeInput {
  /** The page-level live region. */
  readonly announce: (message: string) => void;
}

/**
 * The attachment-branch purge above the rows: a row asks on its
 * repository's behalf, the modal takes the typed confirm, one request
 * runs, and the outcome is announced once. No row leaves the list, so
 * nothing is re-read.
 */
export function useInboxPurgeFacade({ announce }: InboxPurgeFacadeInput) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<InboxItem | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const requestPurge = useCallback((item: InboxItem): void => {
    setPending(item);
  }, []);

  const cancel = useCallback((): void => {
    setPending(undefined);
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (pending === undefined || busy) {
      return;
    }
    setBusy(true);
    let outcome: PurgeOutcome;
    try {
      outcome = (await purgeAttachments(pending.repoId)).kind;
    } catch {
      outcome = RowWriteResultKinds.FAILED;
    }
    setBusy(false);
    setPending(undefined);

    announce(t(PurgeOutcomeCopy[outcome]));
  }, [announce, busy, pending, t]);

  return { pending, busy, requestPurge, cancel, confirm };
}
