import { useEffect } from "react";

import { LANDSCAPE_PHONE_QUERY } from "@web/hooks/useMobileViewport";
import { readContentStarted } from "../ChunkIndicator/utils";
import type { ReadingPositionStore } from "../reading/reading-position";
import { readReadingLine } from "../scroll-to-target/targets";

function isCardOnReadingLine(chunkId: string | null): boolean {
  const card = chunkId === null ? null : document.getElementById(chunkId);
  if (card === null) {
    return false;
  }
  const readingLine = readReadingLine();
  const rect = card.getBoundingClientRect();
  return rect.top <= readingLine && rect.bottom > readingLine;
}

/**
 * A phone turned sideways or back reflows the page under the reader. The
 * chunk they were at is still known, so the page lands on its head again
 * rather than wherever the old scroll offset now falls. A reader above the
 * chunks or in a gap between them stays put: the stored chunk is stale there.
 * Keyed on the query's own change: hydration flips the rendered shape without
 * anything turning, and would replace a chunk link's landing.
 */
export function useRotationHold(
  readingPosition: ReadingPositionStore,
  placeChunkUnderStack: (chunkId: string) => void,
): void {
  useEffect(() => {
    // Read before the turn: the reflow can carry the content start past the line.
    // The spy writes a frame after the scroll, so a write re-reads too.
    let readingChunk = false;
    const trackReader = () => {
      const { activeChunkId } = readingPosition.getState();
      readingChunk = readContentStarted() && isCardOnReadingLine(activeChunkId);
    };
    const holdReader = () => {
      const { activeChunkId, betweenChunks } = readingPosition.getState();
      const holdsChunk =
        readingChunk && !betweenChunks && activeChunkId !== null;
      if (holdsChunk) {
        placeChunkUnderStack(activeChunkId);
      }
    };

    trackReader();
    const query = window.matchMedia(LANDSCAPE_PHONE_QUERY);
    query.addEventListener("change", holdReader);
    window.addEventListener("scroll", trackReader, { passive: true });
    const unsubscribe = readingPosition.subscribe(trackReader);
    return () => {
      query.removeEventListener("change", holdReader);
      window.removeEventListener("scroll", trackReader);
      unsubscribe();
    };
  }, [readingPosition, placeChunkUnderStack]);
}
