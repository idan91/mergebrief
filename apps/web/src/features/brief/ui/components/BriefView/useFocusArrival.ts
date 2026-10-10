import { useEffect, useRef } from "react";

import { resolveLinkChunkId } from "./utils";

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
 * chunk here, which lands through useChunkDeepLink instead.
 */
export function useFocusArrival(input: UseFocusArrivalInput): void {
  const arrival = useRef(input);

  useEffect(() => {
    const landing = arrival.current;
    if (!landing.focusInUrl) {
      return;
    }
    const linkChunkId = resolveLinkChunkId(landing.link);
    const linkLands =
      linkChunkId !== undefined && landing.chunkIds.includes(linkChunkId);
    if (!linkLands) {
      landing.startReadThrough();
    }
  }, []);
}
