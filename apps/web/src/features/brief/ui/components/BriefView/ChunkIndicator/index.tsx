import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { SIDEBAR_PANEL_ID } from "../Sidebar/consts";
import type { ChunkPosition } from "./types";
import { describeChunkPosition } from "./utils";
import styles from "./ChunkIndicator.module.scss";

export interface ChunkIndicatorProps {
  position: ChunkPosition;
  /** Opens the Sidebar sheet; absent leaves the indicator a plain status. */
  openChunks?: (() => void) | undefined;
  /** The Sidebar sheet is open; the indicator is its trigger. */
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/** Where the reader is in the brief, and the way into the Sidebar sheet. */
export function ChunkIndicator({
  position,
  openChunks,
  expanded = false,
  ref,
}: ChunkIndicatorProps) {
  const { t } = useTranslation();
  const label = describeChunkPosition(t, position);
  const controlledPanelId = expanded ? SIDEBAR_PANEL_ID : undefined;

  if (openChunks === undefined) {
    return (
      <span className={styles["indicator"]} data-testid="chunk-indicator">
        <span className={styles["label"]}>{label}</span>
      </span>
    );
  }

  return (
    // oxlint-disable-next-line house/no-raw-button -- the bar's text-and-caret trigger, which the shared buttons do not model
    <button
      aria-controls={controlledPanelId}
      aria-expanded={expanded}
      className={styles["indicator"]}
      data-testid="chunk-indicator"
      ref={ref}
      type="button"
      onClick={openChunks}
    >
      <span className={styles["label"]}>{label}</span>
      <ScreenReaderOnly>{` ${t("brief.mobile.openChunks")}`}</ScreenReaderOnly>
      <Icon
        name={IconNames.CARET_DOWN}
        rotation={IconRotations.HALF}
        size={IconSizes.SM}
      />
    </button>
  );
}
