import type { MediaKey } from "brief-core/media";
import type { Brief } from "brief-core/types";
import { listDescriptionMediaKeys } from "../summary-media-props";

/** The description holds at least one Media item, so `<pr_media>` was offered. */
export function hasDescriptionMedia(brief: Brief): boolean {
  return listDescriptionMediaKeys(brief).length > 0;
}

/** The key of the 1-based `<pr_media>` item `itemNumber`. */
export function readItemKey(brief: Brief, itemNumber: number): MediaKey {
  const key = listDescriptionMediaKeys(brief)[itemNumber - 1];
  if (key === undefined) {
    throw new Error(`the description holds no Media item ${itemNumber}`);
  }
  return key;
}
