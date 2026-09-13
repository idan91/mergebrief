import { Fragment, type ReactNode } from "react";

import type { DiffLine, RowTokenMap } from "@web/utils/diffTokens/types";
import { DiffCodeText } from "../DiffCodeText/DiffCodeText";
import { DIFF_LINE_SIGNS } from "@web/utils/diffTokens/consts";
import { pairSplitRows } from "../pairSplitRows";
import {
  type DiffRowAttributeSlot,
  type DiffRowSlot,
  type DiffUnderRowSlot,
  type SplitCell,
  type SplitRow,
  type SplitSide,
  SplitSides,
} from "../types";
import rowStyles from "../DiffRows.module.scss";
import styles from "./SplitRows.module.scss";

export interface SplitRowsProps {
  rows: DiffLine[];
  /** Pairs built by the caller once per diff; computed here when absent. */
  pairs?: SplitRow[] | undefined;
  tokensByRow?: RowTokenMap | undefined;
  tokensPending?: boolean | undefined;
  gutterCell?: DiffRowSlot | undefined;
  codeTrailer?: DiffRowSlot | undefined;
  underRow?: DiffUnderRowSlot | undefined;
  rowAttributes?: DiffRowAttributeSlot | undefined;
}

const SIDE_COLUMNS = 2;
// A zero-width space keeps an empty side a real cell in the table's tree.
const EMPTY_SIDE = "\u200B";
const GUTTER_COLUMNS = 1;

/**
 * Two sides per row, paired positionally per hunk. The pair is one `<tr>` so
 * a wrapped line on one side keeps the other side's row aligned. Kind, tint
 * and hue ride the cells, never the row.
 */
export function SplitRows({
  rows,
  pairs: givenPairs,
  tokensByRow,
  tokensPending = false,
  gutterCell,
  codeTrailer,
  underRow,
  rowAttributes,
}: SplitRowsProps) {
  const pairs = givenPairs ?? pairSplitRows(rows);
  const gutterColumns = gutterCell === undefined ? 0 : GUTTER_COLUMNS;
  const columnCount = gutterColumns + SIDE_COLUMNS * 2;

  return (
    <tbody
      data-tokens={tokensPending ? "pending" : undefined}
      data-view="split"
    >
      {pairs.map((pair) => {
        if (pair.full !== undefined) {
          return (
            <tr
              className={rowStyles["line"]}
              data-line-kind={pair.full.line.kind}
              key={pair.key}
            >
              <td colSpan={columnCount}>{pair.full.line.content}</td>
            </tr>
          );
        }

        const lead = pair.right ?? pair.left;
        if (lead === undefined) return null;
        const attributes = rowAttributes?.(lead.line, lead.index) ?? {};
        const leftAttributes =
          pair.left === undefined || pair.left === pair.right
            ? attributes
            : (rowAttributes?.(pair.left.line, pair.left.index) ?? {});

        return (
          <Fragment key={pair.key}>
            <tr
              aria-describedby={joinDescribedBy(leftAttributes, attributes)}
              aria-disabled={attributes.disabled ? true : undefined}
              className={`${rowStyles["line"]} ${styles["pair"]}`}
            >
              {gutterCell?.(lead.line, lead.index)}
              <SideCells
                cell={pair.left}
                codeTrailer={codeTrailer}
                revision={leftAttributes.revision}
                side={SplitSides.LEFT}
                tokensByRow={tokensByRow}
              />
              <SideCells
                cell={pair.right}
                codeTrailer={codeTrailer}
                revision={attributes.revision}
                side={SplitSides.RIGHT}
                tokensByRow={tokensByRow}
              />
            </tr>
            {pair.left !== undefined && pair.left !== pair.right
              ? underRow?.(pair.left.line, pair.left.index, columnCount)
              : null}
            {pair.right !== undefined
              ? underRow?.(pair.right.line, pair.right.index, columnCount)
              : null}
          </Fragment>
        );
      })}
    </tbody>
  );
}

interface SideCellsProps {
  cell: SplitCell | undefined;
  side: SplitSide;
  tokensByRow: RowTokenMap | undefined;
  codeTrailer: DiffRowSlot | undefined;
  revision: string | undefined;
}

// Read-only sides: no anchor attributes or handlers until the split view
// learns selection, so a click on the left half cannot anchor on the right.
function SideCells({
  cell,
  side,
  tokensByRow,
  codeTrailer,
  revision,
}: SideCellsProps): ReactNode {
  if (cell === undefined) {
    return (
      <>
        <td
          className={styles["filler"]}
          data-side={side}
          data-testid="diff-filler"
        >
          {EMPTY_SIDE}
        </td>
        <td
          className={styles["filler"]}
          data-side={side}
          data-testid="diff-filler"
        >
          {EMPTY_SIDE}
        </td>
      </>
    );
  }

  const { line, index } = cell;
  const number = side === SplitSides.LEFT ? line.oldLine : line.newLine;

  return (
    <>
      <td
        className={rowStyles["lineNumber"]}
        data-line-kind={line.kind}
        data-line-number=""
        data-side={side}
      >
        {number ?? ""}
      </td>
      <td
        className={rowStyles["code"]}
        data-line-kind={line.kind}
        data-rev={revision}
        data-side={side}
      >
        <span className={rowStyles["sign"]}>{DIFF_LINE_SIGNS[line.kind]}</span>
        <DiffCodeText content={line.content} tokens={tokensByRow?.get(index)} />
        {codeTrailer?.(line, index)}
      </td>
    </>
  );
}

/** Both halves' reasons, so a thread under the removed line is still named. */
function joinDescribedBy(
  left: { describedById?: string | undefined },
  lead: { describedById?: string | undefined },
): string | undefined {
  const ids = [lead.describedById, left.describedById].filter(
    (id) => id !== undefined,
  );
  const unique = [...new Set(ids)];

  return unique.length === 0 ? undefined : unique.join(" ");
}
