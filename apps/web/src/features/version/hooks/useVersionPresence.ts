// What the Account menu shows after a dismissal: the row for the dismissed
// release while it is still the latest, and the dot until the first open.
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { buildVersionQueryOptions } from "../queries";
import {
  deriveDismissedNotice,
  readSeenVersion,
  readServerSeenVersion,
  SEEN_VERSION_UNKNOWN,
  subscribeSeenVersion,
  writeSeenVersion,
  type ReleaseNotice,
} from "../utils";

export interface VersionPresence {
  /** The dismissed release the menu lists; absent clears the row and the dot. */
  readonly notice: ReleaseNotice | undefined;
  /** The dot on the avatar: the row exists and the menu never opened for it. */
  readonly unseen: boolean;
  /** Called when the menu opens; the dot never returns for this release. */
  readonly markSeen: () => void;
}

export function useVersionPresence(): VersionPresence {
  const { data } = useQuery(buildVersionQueryOptions());
  const notice = deriveDismissedNotice(data);
  const seenVersion = useSyncExternalStore(
    subscribeSeenVersion,
    readSeenVersion,
    readServerSeenVersion,
  );

  const markSeen = () => {
    if (notice !== undefined) {
      writeSeenVersion(notice.latest);
    }
  };

  const unseen =
    notice !== undefined &&
    seenVersion !== SEEN_VERSION_UNKNOWN &&
    seenVersion !== notice.latest;

  return { notice, unseen, markSeen };
}
