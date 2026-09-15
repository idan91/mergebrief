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
}

export function RevisionGutterCell({
  run,
  isStart,
  isEnd,
  onRailEnter,
  onRailLeave,
}: RevisionGutterCellProps) {
  const { t } = useTranslation();
  if (!run) return <td className={styles["gutter"]} />;
  const count = run.rowIndexes.length;
  const railKey =
    run.kind === "removed" ? "brief.diff.railRemoved" : "brief.diff.railNew";
  return (
    <td
      className={styles["gutter"]}
      data-rev={run.kind}
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
