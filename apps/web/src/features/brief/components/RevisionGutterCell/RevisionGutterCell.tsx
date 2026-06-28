import type { BriefChunk } from "../../types";
import type { RevisionRun } from "../../revisionChanges";
import styles from "./RevisionGutterCell.module.scss";

export interface RevisionGutterCellProps {
  run: RevisionRun | undefined;
  isStart: boolean;
  isEnd: boolean;
  chunk: BriefChunk;
  onRailEnter: (run: RevisionRun, el: HTMLElement) => void;
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
