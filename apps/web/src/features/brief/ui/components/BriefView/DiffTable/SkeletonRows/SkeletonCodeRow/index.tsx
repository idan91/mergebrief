import type { CSSProperties } from "react";

import { SkeletonSideKinds, type PlannedCodeRow } from "../types";
import styles from "./SkeletonCodeRow.module.scss";
import { SkeletonText } from "./SkeletonText";

interface CodeRowStyle extends CSSProperties {
  "--skeleton-span": number;
}

export interface SkeletonCodeRowProps {
  row: PlannedCodeRow;
  split: boolean;
  /** Columns the view's code cell wraps at. */
  columns: number;
}

/**
 * A code row's cells: the old and new line numbers and the code in the
 * unified view, each side's number and code in the split view. A number
 * the row's kind does not carry draws blank.
 */
export function SkeletonCodeRow({ row, split, columns }: SkeletonCodeRowProps) {
  const style: CodeRowStyle = { "--skeleton-span": row.span };
  const { left, right } = row;

  if (!split || right === undefined) {
    const oldNumber =
      left.kind === SkeletonSideKinds.ADDED
        ? SkeletonSideKinds.EMPTY
        : left.kind;
    const newNumber =
      left.kind === SkeletonSideKinds.REMOVED
        ? SkeletonSideKinds.EMPTY
        : left.kind;
    return (
      <div
        className={styles["code"]}
        data-variant={left.kind}
        data-view="unified"
        style={style}
      >
        <span className={styles["number"]} data-variant={oldNumber} />
        <span className={styles["number"]} data-variant={newNumber} />
        <SkeletonText columns={columns} side={left} span={row.span} />
      </div>
    );
  }

  return (
    <div className={styles["code"]} data-view="split" style={style}>
      <span className={styles["number"]} data-variant={left.kind} />
      <SkeletonText columns={columns} side={left} span={row.span} />
      <span className={styles["number"]} data-variant={right.kind} />
      <SkeletonText columns={columns} side={right} span={row.span} />
    </div>
  );
}
