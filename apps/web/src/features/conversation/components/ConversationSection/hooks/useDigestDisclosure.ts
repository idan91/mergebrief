import { useCallback, useState } from "react";

import { toggleSet } from "@web/utils/collections";
import { DigestRowKinds, type DigestGroup } from "../../../utils/digest";
import { holdsThread } from "../utils";

/** What the digest has open, keyed by thread and group id so a refetch keeps it. */
export interface DigestDisclosure {
  expandedThreads: ReadonlySet<number>;
  expandedGroups: ReadonlySet<string>;
  shownAllGroups: ReadonlySet<string>;
  toggleThread: (threadId: number) => void;
  toggleGroup: (key: string) => void;
  showAll: (groupId: string) => void;
  /**
   * Opens everything that could hide a thread's row: its detail, its group's
   * show-more cap and a bot group holding it. A row behind any of these never
   * renders, so it could never be landed on.
   */
  revealThread: (threadId: number, digest: readonly DigestGroup[]) => void;
}

export function useDigestDisclosure(): DigestDisclosure {
  const [expandedThreads, setExpandedThreads] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [shownAllGroups, setShownAllGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // Stable: the landing effect lists it as a dependency.
  const revealThread = useCallback(
    (threadId: number, digest: readonly DigestGroup[]) => {
      setExpandedThreads((current) => new Set(current).add(threadId));
      for (const group of digest) {
        for (const row of group.rows) {
          if (!holdsThread(row, threadId)) {
            continue;
          }
          setShownAllGroups((current) => new Set(current).add(group.id));
          if (row.kind === DigestRowKinds.BOT_GROUP) {
            setExpandedGroups((current) =>
              new Set(current).add(`${group.id}:${row.author}`),
            );
          }
        }
      }
    },
    [],
  );

  return {
    expandedThreads,
    expandedGroups,
    shownAllGroups,
    toggleThread: (threadId) =>
      setExpandedThreads((current) => toggleSet(current, threadId)),
    toggleGroup: (key) =>
      setExpandedGroups((current) => toggleSet(current, key)),
    showAll: (groupId) =>
      setShownAllGroups((current) => new Set(current).add(groupId)),
    revealThread,
  };
}
