import type { MediaKey } from "brief-core/media";

import type { StripEntry } from "../MediaStrip/types";

/** The pointer line: the model's label and the place the lightbox opens at. */
export interface SummaryMediaPointer {
  readonly label: string;
  readonly firstItemKey: MediaKey;
}

/** The stored Summary Media laid onto the strip's entries; a key the strip lacks is gone. */
export interface PlacedSummaryMedia {
  readonly beforeLede: readonly StripEntry[];
  readonly afterLede: readonly StripEntry[];
  readonly pointer?: SummaryMediaPointer;
}
