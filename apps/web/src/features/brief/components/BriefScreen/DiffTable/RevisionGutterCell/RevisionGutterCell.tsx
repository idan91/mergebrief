/* oxlint-disable jsx-a11y/control-has-associated-label --
   The gutter <td> only carries mouse-hover handlers for the rail preview
   (decorative); the accessible, labelled control is the jump button inside
   it, which exposes the same preview via onFocus. */
import type { BriefChunk } from "../../../../types";
import {
  comparisonRunKey,
  REVISION_JUMP_ATTR,
  type ComparisonRun,
} from "../../../../comparison/comparison";
import styles from "./RevisionGutterCell.module.scss";
import { useTranslation } from "react-i18next";

export interface RevisionGutterCellProps {
  run: ComparisonRun | undefined;
  isStart: boolean;
  isEnd: boolean;
  chunk: BriefChunk;
  onRailEnter: (run: ComparisonRun, el: HTMLElement) => void;
  onRailLeave: (el: HTMLElement) => void;
  /** The row sits inside a sibling span; the gutter carries the frame's edge. */
  spanned?: boolean | undefined;
}

export function RevisionGutterCell({
  run,
  isStart,
  isEnd,
  onRailEnter,
  onRailLeave,
  spanned = false,
}: RevisionGutterCellProps) {
  const { t } = useTranslation();
  const spanAttribute = spanned ? "" : undefined;
  if (!run)
    return <td className={styles["gutter"]} data-span={spanAttribute} />;
  const count = run.rowIndexes.length;
  const railKey =
    run.kind === "removed" ? "brief.diff.railRemoved" : "brief.diff.railNew";
  return (
    <td
      className={styles["gutter"]}
      data-rev={run.kind}
      data-span={spanAttribute}
      onMouseEnter={(e) => onRailEnter(run, e.currentTarget)}
    >
      {isStart ? (
        // oxlint-disable-next-line house/no-raw-button -- invisible gutter overlay: the hit area is not the visual element
        <button
          className={styles["railButton"]}
          {...{ [REVISION_JUMP_ATTR]: comparisonRunKey(run) }}
          type="button"
          aria-label={t(railKey, { count })}
          onFocus={(e) => onRailEnter(run, e.currentTarget)}
          onBlur={(e) => onRailLeave(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
      ) : null}
      <span
        className={styles["rail"]}
        data-end={isEnd ? "" : undefined}
        data-start={isStart ? "" : undefined}
        aria-hidden="true"
      />
    </td>
  );
}
