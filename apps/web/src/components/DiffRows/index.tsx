import { Fragment } from "react";
import { DIFF_LINE_SIGNS } from "@web/utils/diffTokens/consts";
import { DiffCodeText } from "./DiffCodeText";
import { SplitRows } from "./SplitRows";
import { type DiffRowsProps, DiffViews } from "./types";
import { buildDiffRowKeys, isFullWidthDiffRow } from "./utils";
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
  emphasisByRow,
  tokensPending = false,
  gutterCell,
  codeTrailer,
  underRow,
  rowAttributes,
  anchorAttributes = NO_ANCHOR_ATTRIBUTES,
  lineNumberAttributes = NO_ANCHOR_ATTRIBUTES,
  lineNumbers = true,
  fullRow,
  beforeRow,
  trailingRow,
}: DiffRowsProps) {
  const gutterColumns = gutterCell === undefined ? 0 : GUTTER_COLUMNS;
  const numberColumns = lineNumbers ? LINE_NUMBER_COLUMNS : 0;
  const columnCount = CODE_COLUMNS + gutterColumns + numberColumns;

  if (view === DiffViews.SPLIT) {
    return (
      <SplitRows
        anchorAttributes={anchorAttributes}
        lineNumberAttributes={lineNumberAttributes}
        codeTrailer={codeTrailer}
        gutterCell={gutterCell}
        pairs={pairs}
        rowAttributes={rowAttributes}
        rows={rows}
        tokensByRow={tokensByRow}
        emphasisByRow={emphasisByRow}
        tokensPending={tokensPending}
        underRow={underRow}
        fullRow={fullRow}
        beforeRow={beforeRow}
        trailingRow={trailingRow}
      />
    );
  }

  const keys = buildDiffRowKeys(rows);

  return (
    <tbody data-tokens={tokensPending ? "pending" : undefined}>
      {rows.map((row, index) => {
        const key = keys[index] ?? String(index);
        if (isFullWidthDiffRow(row)) {
          return (
            <Fragment key={key}>
              {beforeRow?.(row, index, columnCount)}
              <tr className={styles["line"]} data-line-kind={row.kind}>
                {fullRow?.(row, index, columnCount) ?? (
                  <td colSpan={columnCount}>{row.content}</td>
                )}
              </tr>
            </Fragment>
          );
        }
        const attributes = rowAttributes?.(row, index) ?? {};

        return (
          <Fragment key={key}>
            {beforeRow?.(row, index, columnCount)}
            <tr
              aria-describedby={attributes.describedById}
              aria-disabled={attributes.disabled ? true : undefined}
              className={styles["line"]}
              data-commentable={attributes.commentable ? "" : undefined}
              data-line-kind={row.kind}
              data-line-origin={row.origin}
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
                    {...lineNumberAttributes}
                    className={styles["lineNumber"]}
                    data-line-number=""
                    data-line-old={row.oldLine}
                  >
                    {row.oldLine ?? ""}
                  </td>
                  <td
                    {...lineNumberAttributes}
                    className={styles["lineNumber"]}
                    data-line-number=""
                    data-line-new={row.newLine}
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
                  emphasis={emphasisByRow?.get(index)}
                  tokens={tokensByRow?.get(index)}
                />
                {codeTrailer?.(row, index)}
              </td>
            </tr>
            {underRow?.(row, index, columnCount)}
          </Fragment>
        );
      })}
      {trailingRow?.(columnCount)}
    </tbody>
  );
}
