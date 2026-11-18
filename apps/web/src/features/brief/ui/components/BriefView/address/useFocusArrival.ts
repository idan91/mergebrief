import { useEffect, useRef } from "react";

import { resolveLinkChunkId } from "../utils";

export interface UseFocusArrivalInput {
  /** The focus param the page arrived with. */
  focusInUrl: boolean;
  /** The link param the page arrived with. */
  link: string | undefined;
  chunkIds: readonly string[];
  startReadThrough: () => void;
}

/**
 * An arrival in Focus mode opens on the first chunk unless its link names a
 * chunk here, which scrolls through useChunkDeepLink instead.
 */
export function useFocusArrival(input: UseFocusArrivalInput): void {
  const arrival = useRef(input);

  useEffect(() => {
    const arrived = arrival.current;
    if (!arrived.focusInUrl) {
      return;
    }
    const linkChunkId = resolveLinkChunkId(arrived.link);
    const linkScrolls =
      linkChunkId !== undefined && arrived.chunkIds.includes(linkChunkId);
    if (!linkScrolls) {
      arrived.startReadThrough();
    }
  }, []);
}
