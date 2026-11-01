import type { MediaKey } from "brief-core/media";
import {
  SummaryMediaPositions,
  type SummaryMedia,
  type SummaryMediaPosition,
} from "brief-core/types";
import type { Mutable } from "types/utils";

import type { StripEntry } from "../MediaStrip/types";
import type { PlacedSummaryMedia } from "./types";

function readShownAt(
  summaryMedia: SummaryMedia,
  position: SummaryMediaPosition,
  entryByKey: ReadonlyMap<MediaKey, StripEntry>,
): StripEntry[] {
  return summaryMedia.shown.flatMap((shown) => {
    const entry = entryByKey.get(shown.key);
    const shownHere = shown.position === position && entry !== undefined;
    return shownHere ? [entry] : [];
  });
}

/**
 * Lays the stored Summary Media onto the strip. A key that names no strip
 * entry (an outside-host video, a pasted line not confirmed a video) is
 * dropped silently, and a pointer left with no item is dropped with it.
 */
export function placeSummaryMedia(
  summaryMedia: SummaryMedia | undefined,
  entries: readonly StripEntry[],
): PlacedSummaryMedia {
  if (summaryMedia === undefined) {
    return { beforeLede: [], afterLede: [] };
  }

  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const placed: Mutable<PlacedSummaryMedia> = {
    beforeLede: readShownAt(
      summaryMedia,
      SummaryMediaPositions.BEFORE_LEDE,
      entryByKey,
    ),
    afterLede: readShownAt(
      summaryMedia,
      SummaryMediaPositions.AFTER_LEDE,
      entryByKey,
    ),
  };
  const pointer = summaryMedia.pointer;
  const firstItemKey = pointer?.items.find((key) => entryByKey.has(key));
  if (pointer !== undefined && firstItemKey !== undefined) {
    placed.pointer = { label: pointer.label, firstItemKey };
  }
  return placed;
}
