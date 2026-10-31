import type { CSSProperties } from "react";

import { SkeletonSideKinds, type SkeletonSide } from "../../types";
import { NO_BREAK, NO_WRAPS } from "./consts";
import styles from "./SkeletonText.module.scss";
import { planWrapLines } from "./utils";

interface TextStyle extends CSSProperties {
  "--skeleton-indent": number;
  "--skeleton-columns": number;
  "--skeleton-token-first": number;
  "--skeleton-token-second": number;
}

interface WrapStyle extends CSSProperties {
  "--skeleton-line": number;
  "--skeleton-columns": number;
}

export interface SkeletonTextProps {
  side: SkeletonSide;
  /** Lines the row takes. */
  span: number;
  /** Columns the view's code cell wraps at. */
  columns: number;
}

/** One side's code: a bar from its indent, and a bar per line it wraps onto. */
export function SkeletonText({ side, span, columns }: SkeletonTextProps) {
  const style: TextStyle = {
    "--skeleton-indent": side.indent,
    "--skeleton-columns": Math.max(side.width - side.indent, 0),
    "--skeleton-token-first": side.breaks[0] ?? NO_BREAK,
    "--skeleton-token-second": side.breaks[1] ?? NO_BREAK,
  };
  const empty = side.kind === SkeletonSideKinds.EMPTY;
  const wraps = empty ? NO_WRAPS : planWrapLines(side.width, span, columns);
  const wrapBars = wraps.map((wrap) => {
    const wrapStyle: WrapStyle = {
      "--skeleton-line": wrap.line,
      "--skeleton-columns": wrap.columns,
    };
    return { key: wrap.line, style: wrapStyle };
  });

  return (
    <span className={styles["text"]} data-variant={side.kind} style={style}>
      {wrapBars.map((bar) => (
        <i className={styles["wrap"]} key={bar.key} style={bar.style} />
      ))}
    </span>
  );
}
