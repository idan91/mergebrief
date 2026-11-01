import type { SummaryMediaPosition } from "brief-core/types";

import type { MediaLightboxHandle } from "@web/components/Markdown/context";
import type { StripEntry } from "../../MediaStrip/types";
import { SHOWN_ROW_STYLE } from "./consts";
import { ShownItem } from "./ShownItem";
import styles from "./ShownMedia.module.scss";

export interface ShownMediaProps {
  entries: readonly StripEntry[];
  position: SummaryMediaPosition;
  /** Opens the lightbox at an entry; focus returns to `opener` on close. */
  onOpen: MediaLightboxHandle["openMedia"];
}

/** The Summary Media shown at one position: side by side, stacking when the Summary is narrow. */
export function ShownMedia({ entries, position, onOpen }: ShownMediaProps) {
  if (entries.length === 0) {
    return null;
  }

  const testId = `summary-media-${position}`;
  return (
    <div className={styles["row"]} data-testid={testId} style={SHOWN_ROW_STYLE}>
      {entries.map((entry) => (
        <div className={styles["item"]} key={entry.key}>
          <ShownItem entry={entry} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}
