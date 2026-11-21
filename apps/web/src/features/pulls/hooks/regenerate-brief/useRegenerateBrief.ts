// The Regenerate write's hook: pending, the re-entry guard, the outcome
// announcement and the meta refresh. Nothing else calls the write.
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAnnouncer } from "@web/hooks/useAnnouncer";

import { buildPrMetaQueryOptions } from "../../queries";
import { regenerateBrief } from "../../transport/regenerate";
import { RegenerateResultKinds, type RegenerateNoticeKeys } from "../../types";
import {
  useArrivalAnnouncement,
  type RunArrival,
} from "./useArrivalAnnouncement";
import {
  readRegenerateNotice,
  RegenerateNotices,
  refreshesMeta,
} from "./utils";

export interface UseRegenerateBriefInput {
  readonly repoId: string;
  readonly prNumber: number;
  /** The card's own copy per answer; Regenerate's by default. */
  readonly notices?: RegenerateNoticeKeys;
  /** Once a queued run's brief lands, `notice` is announced in the same region. */
  readonly arrival?: RunArrival;
  /** A page-level live region to speak through instead of this hook's own. */
  readonly announce?: (text: string) => void;
  /** Another read an answer that refreshes the meta leaves stale too. */
  readonly alsoInvalidates?: QueryKey;
}

export interface RegenerateBrief {
  readonly pending: boolean;
  /** The text of one persistent polite live region, empty until an outcome needs words. */
  readonly announcement: string;
  readonly regenerate: () => void;
}

export function useRegenerateBrief({
  repoId,
  prNumber,
  notices = RegenerateNotices,
  arrival,
  announce: announceElsewhere,
  alsoInvalidates,
}: UseRegenerateBriefInput): RegenerateBrief {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const announcer = useAnnouncer();
  const announce = announceElsewhere ?? announcer.announce;
  const markQueued = useArrivalAnnouncement(arrival, announce);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  function regenerate(): void {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    const requestedHead = arrival?.head;

    void (async () => {
      try {
        const { kind } = await regenerateBrief(repoId, prNumber);
        if (kind === RegenerateResultKinds.QUEUED) {
          markQueued(requestedHead);
        }
        if (refreshesMeta(kind)) {
          const metaKey = buildPrMetaQueryOptions(repoId, prNumber).queryKey;
          const staleKeys =
            alsoInvalidates === undefined
              ? [metaKey]
              : [metaKey, alsoInvalidates];
          const refreshes = staleKeys.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          );
          await Promise.all(refreshes);
        }
        const notice = readRegenerateNotice(t, kind, notices);
        if (notice !== undefined) {
          announce(notice);
        }
      } catch (error) {
        console.error("regenerate failed", error);
        const notice = readRegenerateNotice(
          t,
          RegenerateResultKinds.INDETERMINATE,
          notices,
        );
        if (notice !== undefined) {
          announce(notice);
        }
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
  }

  return { pending, announcement: announcer.text, regenerate };
}
