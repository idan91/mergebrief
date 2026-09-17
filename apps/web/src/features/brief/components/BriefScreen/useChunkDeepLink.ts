import { useEffect, useRef } from "react";

import { resolveChunkIdFromHash } from "./utils";

export interface UseChunkDeepLinkInput {
  briefId: string;
  chunkIds: readonly string[];
  /** False while another landing owns the arrival, such as a thread target. */
  enabled: boolean;
  /**
   * Lands on the chunk: opens the card, scrolls, focuses. Returns false when
   * it could not schedule a landing, so the hash keeps its one chance.
   */
  land: (chunkId: string) => boolean;
}

/**
 * A hash naming a chunk lands on it once per brief. The browser's own hash
 * scroll cannot find a windowed card, so the landing goes through the app's
 * jump, which asks the windows to mount it. The one chance is spent by a
 * scheduled landing or by yielding to another arrival, never by a chunk
 * list that does not carry the id yet.
 */
export function useChunkDeepLink({
  briefId,
  chunkIds,
  enabled,
  land,
}: UseChunkDeepLinkInput): void {
  const landedFor = useRef<string | null>(null);

  useEffect(() => {
    if (landedFor.current === briefId) return;
    const chunkId = resolveChunkIdFromHash(window.location.hash);
    if (chunkId === undefined) return;
    if (!enabled) {
      landedFor.current = briefId;
      return;
    }
    if (!chunkIds.includes(chunkId)) return;
    if (land(chunkId)) landedFor.current = briefId;
  }, [briefId, chunkIds, enabled, land]);
}
