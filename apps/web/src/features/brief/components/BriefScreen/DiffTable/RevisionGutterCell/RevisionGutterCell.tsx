/* oxlint-disable jsx-a11y/control-has-associated-label --
   The gutter <td> only carries mouse-hover handlers for the rail preview
   (decorative); the accessible, labelled control is the jump button inside
   it, which exposes the same preview via onFocus. */
import type { BriefChunk } from "../../../../types";
import type { ComparisonRun } from "../../../../comparison/comparison";
import styles from "./RevisionGutterCell.module.scss";
import { RevisionJumpButton } from "./RevisionJumpButton/RevisionJumpButton";

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
  const spanAttribute = spanned ? "" : undefined;
  if (!run)
    return <td className={styles["gutter"]} data-span={spanAttribute} />;
  return (
    <td
      className={styles["gutter"]}
      data-rev={run.kind}
      data-span={spanAttribute}
      onMouseEnter={(e) => onRailEnter(run, e.currentTarget)}
    >
      {isStart ? (
        <RevisionJumpButton
          className={styles["railButton"]}
          onRailEnter={onRailEnter}
          onRailLeave={onRailLeave}
          run={run}
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
