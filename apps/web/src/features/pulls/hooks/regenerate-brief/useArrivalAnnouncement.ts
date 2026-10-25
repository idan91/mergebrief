import type { TranslationKey } from "i18n";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Whether the brief a run asks for has landed, and what the region then says. */
export interface RunArrival {
  /** The span the run asks for is briefed. */
  readonly arrived: boolean;
  /** The head the pull request names now; a run asked for another is superseded. */
  readonly head?: string | undefined;
  readonly notice: TranslationKey;
}

/** A run queued here whose brief has not been announced. */
interface AwaitedRun {
  readonly head: string | undefined;
}

/**
 * Announces the brief a queued run asked for once it lands. No `arrival`
 * means the caller announces none; the returned mark arms the announcement
 * when the run is queued, so a brief nobody asked for here stays quiet. It
 * takes the head read at the click; a run whose own answer moves the head
 * passes none.
 */
export function useArrivalAnnouncement(
  arrival: RunArrival | undefined,
  announce: (text: string) => void,
): (head?: string) => void {
  const { t } = useTranslation();
  const awaited = useRef<AwaitedRun | undefined>(undefined);
  const arrived = arrival?.arrived === true;
  const head = arrival?.head;
  const notice = arrival?.notice;

  useEffect(() => {
    const run = awaited.current;
    if (run === undefined || notice === undefined) {
      return;
    }
    const superseded = run.head !== undefined && run.head !== head;
    if (superseded) {
      awaited.current = undefined;
      return;
    }
    if (!arrived) {
      return;
    }
    awaited.current = undefined;
    announce(t(notice));
  }, [announce, arrived, head, notice, t]);

  return useCallback((requestedHead?: string) => {
    awaited.current = { head: requestedHead };
  }, []);
}
