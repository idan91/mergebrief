import { MediaKinds } from "brief-core/media";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { IconNames } from "@web/components/Icon/types";
import { DIAGRAM_TITLE_KEYS } from "@web/components/MermaidDiagram/consts";
import { KIND_LABEL_KEYS } from "../consts";
import type { StripEntry } from "../types";
import { readEntryLabel } from "../utils";
import { TileImage } from "./TileImage";
import { TilePlaceholder } from "./TilePlaceholder";
import styles from "./MediaTile.module.scss";

export interface MediaTileProps {
  entry: StripEntry;
}

/** One strip place: a thumbnail, or a placeholder that fetches nothing, over its caption. */
export function MediaTile({ entry }: MediaTileProps) {
  const { t } = useTranslation();
  const label = readEntryLabel(t, entry);

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
      <span className={styles["frame"]}>{visual}</span>
      <span className={styles["caption"]} title={label}>
        {label}
      </span>
    </li>
  );
}
