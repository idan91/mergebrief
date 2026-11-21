// The every-push switch's hook: the requested state while the write runs,
// the re-entry guard, the announcement and the refresh. A failed write
// clears the request, so the control reads the server's state again.
// A saved write refreshes PR meta first, which may unmount the caller, so a
// caller that can leave speaks through a page-level region.
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAnnouncer } from "@web/hooks/useAnnouncer";

import { buildPrMetaQueryOptions } from "../../queries";
import {
  turnOffGenerateEveryPush,
  turnOnGenerateEveryPush,
} from "../../transport/generateEveryPush";
import { EveryPushResultKinds } from "../../types";
import { readEveryPushNotice } from "./utils";

export interface UseGenerateEveryPushInput {
  readonly repoId: string;
  readonly prNumber: number;
  /** The switch as the server last reported it. */
  readonly on: boolean;
  /** A page-level live region to speak through; the outcome text still comes back for display. */
  readonly announce?: (text: string) => void;
  /** Another read a saved switch leaves stale too. */
  readonly alsoInvalidates?: QueryKey;
}

export interface GenerateEveryPush {
  /** The state the control shows: the requested one while the write runs. */
  readonly checked: boolean;
  readonly pending: boolean;
  /**
   * The outcome text, empty until an outcome needs words: for one persistent
   * polite live region, or for display when `announce` speaks it.
   */
  readonly announcement: string;
  readonly setOn: (next: boolean) => void;
}

export function useGenerateEveryPush({
  repoId,
  prNumber,
  on,
  announce: announceElsewhere,
  alsoInvalidates,
}: UseGenerateEveryPushInput): GenerateEveryPush {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const announcer = useAnnouncer();
  const [requested, setRequested] = useState<boolean | undefined>(undefined);
  const inFlight = useRef(false);

  function announce(text: string): void {
    announcer.announce(text);
    announceElsewhere?.(text);
  }

  function setOn(next: boolean): void {
    if (inFlight.current || next === on) {
      return;
    }
    inFlight.current = true;
    setRequested(next);

    void (async () => {
      try {
        const write = next ? turnOnGenerateEveryPush : turnOffGenerateEveryPush;
        const { kind } = await write(repoId, prNumber);
        if (kind === EveryPushResultKinds.SAVED) {
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
        announce(readEveryPushNotice(t, kind, next));
      } catch (error) {
        console.error("generate on every push failed", error);
        announce(
          readEveryPushNotice(t, EveryPushResultKinds.INDETERMINATE, next),
        );
      } finally {
        inFlight.current = false;
        setRequested(undefined);
      }
    })();
  }

  return {
    checked: requested ?? on,
    pending: requested !== undefined,
    announcement: announcer.text,
    setOn,
  };
}
