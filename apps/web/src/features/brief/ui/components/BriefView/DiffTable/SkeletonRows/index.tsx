import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import {
  estimateReservedRowsHeight,
  resolveWrapHistogram,
} from "../../reading/chunk-height-model";
import { MIN_LINE_DIGITS } from "./consts";
import { planSkeletonRows } from "./row-plan";
import { SkeletonCodeRow } from "./SkeletonCodeRow";
import { SkeletonLane } from "./SkeletonLane";
import styles from "./SkeletonRows.module.scss";
import { SkeletonRowTypes } from "./types";
import { useReducedMotion } from "./useReducedMotion";
import { alignShine } from "./utils";

interface SkeletonStyle extends CSSProperties {
  "--skeleton-block-size": string;
  "--skeleton-digits": number;
}

export interface SkeletonRowsProps {
  counts: ChunkLayoutCounts;
  view: DiffView;
  /** Digits the card's widest line number takes. */
  digits?: number;
}

/**
 * The rows a card will draw once its code lands, at the height the stored
 * counts reserve, so the page's layout holds when the code replaces them:
 * the diff's own anatomy in muted ink where stored row runs say where the
 * changes sit, a colourless shape where none does. A soft band sweeps
 * across while the card waits.
 */
export function SkeletonRows({
  counts,
  view,
  digits = MIN_LINE_DIGITS,
}: SkeletonRowsProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const plan = planSkeletonRows(counts, view);
  const split = view === DiffViews.SPLIT;
  const { columns } = resolveWrapHistogram(counts, view);
  const style: SkeletonStyle = {
    "--skeleton-block-size": `${String(estimateReservedRowsHeight(counts, view))}px`,
    "--skeleton-digits": Math.max(digits, MIN_LINE_DIGITS),
  };
  const rows = plan.rows.map((row) =>
    row.type === SkeletonRowTypes.LANE ? (
      <SkeletonLane key={row.key} lane={row} />
    ) : (
      <SkeletonCodeRow
        columns={columns}
        key={row.key}
        row={row}
        split={split}
      />
    ),
  );
  const fill = plan.filled ? (
    <div className={styles["fill"]} data-testid="skeleton-fill" />
  ) : null;

  return (
    <div
      aria-busy="true"
      className={styles["skeleton"]}
      data-ink={plan.ink}
      data-testid="skeleton-rows"
      data-view={view}
      style={style}
    >
      <ScreenReaderOnly>{t("brief.diff.loading")}</ScreenReaderOnly>
      <div aria-hidden="true">
        {rows}
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
          <div className={styles["shineTrack"]} data-layer="shine">
            {rows}
            {fill}
          </div>
        </div>
      )}
    </div>
  );
}
