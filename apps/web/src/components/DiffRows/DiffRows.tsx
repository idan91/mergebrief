import { Fragment } from "react";
import { DIFF_LINE_SIGNS } from "@web/utils/diffTokens/consts";
import { DiffCodeText } from "./DiffCodeText/DiffCodeText";
import { SplitRows } from "./SplitRows/SplitRows";
import { type DiffRowsProps, DiffViews } from "./types";
import { isFullWidthDiffRow } from "./utils";
import styles from "./DiffRows.module.scss";

const NO_ANCHOR_ATTRIBUTES: Record<`data-${string}`, string> = {};
const CODE_COLUMNS = 1;
const GUTTER_COLUMNS = 1;
const LINE_NUMBER_COLUMNS = 2;

export function DiffRows({
  rows,
  view = DiffViews.UNIFIED,
  pairs,
  tokensByRow,
  tokensPending = false,
  gutterCell,
  codeTrailer,
  underRow,
  rowAttributes,
  anchorAttributes = NO_ANCHOR_ATTRIBUTES,
  lineNumbers = true,
}: DiffRowsProps) {
  const gutterColumns = gutterCell === undefined ? 0 : GUTTER_COLUMNS;
  const numberColumns = lineNumbers ? LINE_NUMBER_COLUMNS : 0;
  const columnCount = CODE_COLUMNS + gutterColumns + numberColumns;

  if (view === DiffViews.SPLIT) {
    return (
      <SplitRows
        anchorAttributes={anchorAttributes}
        codeTrailer={codeTrailer}
        gutterCell={gutterCell}
        pairs={pairs}
        rowAttributes={rowAttributes}
        rows={rows}
        tokensByRow={tokensByRow}
        tokensPending={tokensPending}
        underRow={underRow}
      />
    );
  }

  return (
    <tbody data-tokens={tokensPending ? "pending" : undefined}>
      {rows.map((row, index) => {
        const key = `${row.kind}-${index}`;
        if (isFullWidthDiffRow(row)) {
          return (
            <tr className={styles["line"]} data-line-kind={row.kind} key={key}>
              <td colSpan={columnCount}>{row.content}</td>
            </tr>
          );
        }
        const attributes = rowAttributes?.(row, index) ?? {};

        return (
          <Fragment key={key}>
            <tr
              aria-describedby={attributes.describedById}
              aria-disabled={attributes.disabled ? true : undefined}
              className={styles["line"]}
              data-commentable={attributes.commentable ? "" : undefined}
              data-line-kind={row.kind}
              data-rev={attributes.revision}
              data-selected={attributes.selected ? "" : undefined}
              onKeyDown={attributes.onKeyDown}
              onMouseDown={attributes.onMouseDown}
              onMouseEnter={attributes.onMouseEnter}
              onMouseUp={attributes.onMouseUp}
              tabIndex={attributes.focusable ? 0 : undefined}
            >
              {gutterCell?.(row, index)}
              {lineNumbers ? (
                <>
                  <td
                    {...anchorAttributes}
                    className={styles["lineNumber"]}
                    data-line-number=""
                  >
                    {row.oldLine ?? ""}
                  </td>
                  <td
                    {...anchorAttributes}
                    className={styles["lineNumber"]}
                    data-line-number=""
                  >
                    {row.newLine ?? ""}
                  </td>
                </>
              ) : null}
              <td className={styles["code"]}>
                <span {...anchorAttributes} className={styles["sign"]}>
                  {DIFF_LINE_SIGNS[row.kind]}
                </span>
                <DiffCodeText
                  content={row.content}
                  tokens={tokensByRow?.get(index)}
                />
                {codeTrailer?.(row, index)}
              </td>
            </tr>
            {underRow?.(row, index, columnCount)}
          </Fragment>
        );
      })}
    </tbody>
  );
}
