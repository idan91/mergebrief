import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { estimateReservedRowsHeight } from "../../reading/chunk-height-model";
import styles from "./SkeletonRows.module.scss";
import { useReducedMotion } from "./useReducedMotion";
import { alignShine, planSkeletonRows } from "./utils";

interface SkeletonStyle extends CSSProperties {
  "--skeleton-block-size": string;
}

export interface SkeletonRowsProps {
  counts: ChunkLayoutCounts;
  view: DiffView;
}

/**
 * The rows a card will draw once its code lands, at the height the stored
 * counts reserve, so the page's layout holds when the code replaces them.
 * A soft band sweeps across the bars while the card waits.
 */
export function SkeletonRows({ counts, view }: SkeletonRowsProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const { rows, filled } = planSkeletonRows(counts, view);
  const split = view === DiffViews.SPLIT;
  const reservedHeight = estimateReservedRowsHeight(counts, view);
  const style: SkeletonStyle = {
    "--skeleton-block-size": `${String(reservedHeight)}px`,
  };
  const bars = rows.map((row) => (
    <div
      className={styles["row"]}
      data-variant={row.tall ? "tall" : undefined}
      key={row.index}
    >
      <span className={styles["gutter"]} />
      <span className={styles["bar"]} style={{ width: row.width }} />
      {split ? (
        <>
          <span className={styles["gutter"]} />
          <span className={styles["bar"]} style={{ width: row.width }} />
        </>
      ) : null}
    </div>
  ));
  // Past the cap, one element repeats the bars down the rest of the well.
  const fill = filled ? (
    <div className={styles["fill"]} data-testid="skeleton-fill" />
  ) : null;

  return (
    <div
      aria-busy="true"
      className={styles["skeleton"]}
      data-testid="skeleton-rows"
      data-view={view}
      style={style}
    >
      <ScreenReaderOnly>{t("brief.diff.loading")}</ScreenReaderOnly>
      <div aria-hidden="true">
        {bars}
        {fill}
      </div>
      {reducedMotion ? null : (
        <div
          aria-hidden="true"
          className={styles["shine"]}
          data-testid="skeleton-shine"
          onAnimationStart={(event) => {
            alignShine(event.currentTarget, event.timeStamp);
          }}
        >
          <div className={styles["shineTrack"]}>
            {bars}
            {fill}
          </div>
        </div>
      )}
    </div>
  );
}
