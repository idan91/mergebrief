import { MediaKinds, type MediaKey } from "brief-core/media";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { IconNames } from "@web/components/Icon/types";
import { DIAGRAM_TITLE_KEYS } from "@web/components/MermaidDiagram/consts";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { FOCUSED_TILE_SCROLL, KIND_LABEL_KEYS } from "../consts";
import type { StripEntry } from "../types";
import { readEntryLabel, readOpenLabel } from "../utils";
import { TileImage } from "./TileImage";
import { TilePlaceholder } from "./TilePlaceholder";
import styles from "./MediaTile.module.scss";

export interface MediaTileProps {
  entry: StripEntry;
  /** Opens the lightbox at this entry; focus returns to `opener` on close. */
  onOpen: (key: MediaKey, opener: HTMLElement) => void;
}

/**
 * One strip place: a thumbnail, or a placeholder that fetches nothing, over
 * its caption. A failed tile still opens the lightbox.
 */
export function MediaTile({ entry, onOpen }: MediaTileProps) {
  const { t } = useTranslation();
  const label = readEntryLabel(t, entry);
  const openLabel = readOpenLabel(t, entry);

  let visual: ReactNode;
  switch (entry.kind) {
    case MediaKinds.IMAGE:
      visual = <TileImage entry={entry} />;
      break;
    case MediaKinds.VIDEO:
      visual = (
        <TilePlaceholder
          icon={IconNames.PLAY}
          label={t(KIND_LABEL_KEYS[MediaKinds.VIDEO])}
        />
      );
      break;
    case MediaKinds.DIAGRAM:
      visual = (
        <TilePlaceholder
          icon={IconNames.TREE_STRUCTURE}
          label={t(DIAGRAM_TITLE_KEYS[entry.diagramType])}
        />
      );
      break;
  }

  return (
    <li
      className={styles["tile"]}
      data-kind={entry.kind}
      data-testid="media-tile"
    >
      {/* oxlint-disable-next-line house/no-raw-button -- the thumbnail itself is the control; no shared primitive wraps an image tile */}
      <button
        aria-haspopup="dialog"
        className={styles["frame"]}
        type="button"
        onClick={(event) => {
          onOpen(entry.key, event.currentTarget);
        }}
        onFocus={(event) => {
          event.currentTarget.scrollIntoView(FOCUSED_TILE_SCROLL);
        }}
      >
        <ScreenReaderOnly>{openLabel}</ScreenReaderOnly>
        {visual}
      </button>
      <span aria-hidden="true" className={styles["caption"]} title={label}>
        {label}
      </span>
    </li>
  );
}
