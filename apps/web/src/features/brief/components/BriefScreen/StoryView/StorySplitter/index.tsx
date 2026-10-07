import { useTranslation } from "react-i18next";

import type { SidebarLayout } from "../../utils";
import { useStorySplitterFacade } from "./useStorySplitterFacade";
import styles from "./StorySplitter.module.scss";

export interface StorySplitterProps {
  /** Which stacked breakpoint applies; the splitter is gone once stacked. */
  sidebar: SidebarLayout | undefined;
  /** The card article's id, the pane the value describes. */
  cardId: string;
  setTrack: (px: number) => void;
  resetTrack: () => void;
}

/**
 * The window splitter between the diffs and the change-group card. Every
 * group mounts one; all of them drive the one track on `.main`.
 */
export function StorySplitter({
  sidebar,
  cardId,
  setTrack,
  resetTrack,
}: StorySplitterProps) {
  const { t } = useTranslation();
  const splitter = useStorySplitterFacade({ sidebar, setTrack, resetTrack });

  if (splitter.stacked) {
    return null;
  }

  const valueText = t("brief.story.splitterValueText", {
    width: splitter.cardWidth,
  });

  return (
    <div
      ref={splitter.setHandle}
      className={`${styles["splitter"]} story-splitter`}
      role="separator"
      data-state={splitter.dragging ? "dragging" : undefined}
      aria-orientation="vertical"
      aria-label={t("brief.story.splitterLabel")}
      aria-controls={cardId}
      aria-valuemin={splitter.floor}
      aria-valuemax={splitter.measured ? splitter.ceiling : undefined}
      aria-valuenow={splitter.measured ? splitter.cardWidth : undefined}
      aria-valuetext={splitter.measured ? valueText : undefined}
      tabIndex={splitter.measured ? 0 : undefined}
      onKeyDown={splitter.onKeyDown}
      onPointerDown={splitter.onPointerDown}
      onPointerMove={splitter.onPointerMove}
      onPointerUp={splitter.onPointerUp}
      onPointerCancel={splitter.onPointerCancel}
      onLostPointerCapture={splitter.onLostPointerCapture}
      onDoubleClick={splitter.onDoubleClick}
    />
  );
}
