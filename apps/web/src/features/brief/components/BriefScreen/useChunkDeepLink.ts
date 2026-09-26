import { type RefObject, useEffect, useRef } from "react";

import type { LineHashTarget } from "@web/features/review/utils";
import { parseLineHash, resolveChunkIdFromHash } from "./utils";

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
  /** Lands on the lines a line hash names; the same false keeps the chance. */
  landLine?: ((target: LineHashTarget) => boolean) | undefined;
  /** The hash this page last wrote itself; arriving on it is not an arrival. */
  writtenHash?: RefObject<string | null> | undefined;
}

/**
 * A hash naming a chunk or a line range lands on it once per brief. The
 * browser's own hash scroll cannot find a windowed card, so the landing goes
 * through the app's jump, which asks the windows to mount it. The one chance
 * is spent by a scheduled landing or by yielding to another arrival, never
 * by a chunk list that does not carry the id yet.
 */
export function useChunkDeepLink({
  briefId,
  chunkIds,
  enabled,
  land,
  landLine,
  writtenHash,
}: UseChunkDeepLinkInput): void {
  const landedFor = useRef<string | null>(null);

  useEffect(() => {
    if (landedFor.current === briefId) {
      return;
    }
    const hash = window.location.hash;
    if (writtenHash?.current !== null && writtenHash?.current === hash) {
      landedFor.current = briefId;
      return;
    }
    const chunkId = resolveChunkIdFromHash(hash);
    if (chunkId !== undefined) {
      if (!enabled) {
        landedFor.current = briefId;
        return;
      }
      if (!chunkIds.includes(chunkId)) {
        return;
      }
      if (land(chunkId)) {
        landedFor.current = briefId;
      }
      return;
    }
    const line = parseLineHash(hash);
    if (!line.ok || landLine === undefined) {
      return;
    }
    if (!enabled) {
      landedFor.current = briefId;
      return;
    }
    if (landLine(line.value)) {
      landedFor.current = briefId;
    }
  }, [briefId, chunkIds, enabled, land, landLine, writtenHash]);
}
