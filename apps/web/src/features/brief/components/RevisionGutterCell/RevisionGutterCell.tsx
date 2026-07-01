import type { BriefChunk } from "../../types";
import type { ComparisonRun } from "../../comparison";
import styles from "./RevisionGutterCell.module.scss";

export interface RevisionGutterCellProps {
  run: ComparisonRun | undefined;
  isStart: boolean;
  isEnd: boolean;
  chunk: BriefChunk;
  onRailEnter: (run: ComparisonRun, el: HTMLElement) => void;
  onRailLeave: () => void;
}

export function RevisionGutterCell({
  run,
  isStart,
  isEnd,
  onRailEnter,
  onRailLeave,
}: RevisionGutterCellProps) {
  if (!run) return <td className={styles["gutter"]} />;
  const count = run.rowIndexes.length;
  const verb = run.kind === "removed" ? "Removed" : "New";
  return (
    <td
      className={styles["gutter"]}
      data-rev={run.kind}
      onMouseEnter={(e) => onRailEnter(run, e.currentTarget)}
      onMouseLeave={onRailLeave}
    >
      {isStart ? (
        <button
          className={styles["railButton"]}
          // CSS-module classnames are hashed at build time, so jump-nav
          // (`useRevisionNavigation`) targets this stable data attribute
          // instead of a class selector.
          data-jump-target=""
          type="button"
          aria-label={`${verb} this revision. ${count} line${count === 1 ? "" : "s"}.`}
          onFocus={(e) => onRailEnter(run, e.currentTarget)}
          onBlur={onRailLeave}
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
