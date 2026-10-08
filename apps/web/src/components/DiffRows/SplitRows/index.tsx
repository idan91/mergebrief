import { Fragment, type KeyboardEvent, type ReactNode } from "react";

import { type DiffLine, type RowTokenMap } from "@web/utils/diffTokens/types";
import { DiffCodeText } from "../DiffCodeText";
import { DIFF_LINE_SIGNS } from "@web/utils/diffTokens/consts";
import { pairSplitRows } from "../pairSplitRows";
import {
  type DiffEdgeRowSlot,
  type DiffFullRowSlot,
  type DiffNumberCellSlot,
  type DiffRowAttributes,
  type DiffRowAttributeSlot,
  type DiffRowSlot,
  type DiffUnderRowSlot,
  type EmphasisByRow,
  NumberCellStates,
  type SplitCell,
  type SplitRow,
  type SplitSide,
  SplitSides,
} from "../types";
import rowStyles from "../DiffRows.module.scss";
import styles from "./SplitRows.module.scss";
import { type DiffSide, DiffSides } from "types/comments";

export interface SplitRowsProps {
  rows: DiffLine[];
  /** Pairs built by the caller once per diff; computed here when absent. */
  pairs?: SplitRow[] | undefined;
  tokensByRow?: RowTokenMap | undefined;
  emphasisByRow?: EmphasisByRow | undefined;
  tokensPending?: boolean | undefined;
  gutterCell?: DiffRowSlot | undefined;
  seamCell?: DiffRowSlot | undefined;
  codeTrailer?: DiffRowSlot | undefined;
  lineNumberContent?: DiffNumberCellSlot | undefined;
  underRow?: DiffUnderRowSlot | undefined;
  rowAttributes?: DiffRowAttributeSlot | undefined;
  anchorAttributes: Record<string, string>;
  lineNumberAttributes?: Record<string, string> | undefined;
  fullRow?: DiffFullRowSlot | undefined;
  beforeRow?: DiffFullRowSlot | undefined;
  trailingRow?: DiffEdgeRowSlot | undefined;
}

/** Each side spans a number cell and a code cell. */
export const SPLIT_SIDE_COLUMNS = 2;
const GUTTER_COLUMNS = 1;
// A zero-width space keeps an empty side a real cell in the table's tree.
const EMPTY_SIDE = "\u200B";
/** Off the Tab order, reachable by the arrow hop from the other side. */
const ARROW_ONLY_STOP = -1;
const NO_ATTRIBUTES: DiffRowAttributes = {};
const NO_LINE_NUMBER_ATTRIBUTES: Record<string, string> = {};

/**
 * Two sides per row, paired positionally per hunk. The pair is one `<tr>` so
 * a wrapped line on one side keeps the other side's row aligned. Kind, tint,
 * hue, selection and the handlers ride the cells, never the row: each side
 * anchors on its own line.
 */
export function SplitRows({
  rows,
  pairs: givenPairs,
  tokensByRow,
  emphasisByRow,
  tokensPending = false,
  gutterCell,
  seamCell,
  codeTrailer,
  lineNumberContent,
  underRow,
  rowAttributes,
  anchorAttributes,
  lineNumberAttributes = NO_LINE_NUMBER_ATTRIBUTES,
  fullRow,
  beforeRow,
  trailingRow,
}: SplitRowsProps) {
  const pairs = givenPairs ?? pairSplitRows(rows);
  const gutterColumns = gutterCell === undefined ? 0 : GUTTER_COLUMNS;
  const seamColumns = seamCell === undefined ? 0 : GUTTER_COLUMNS;
  // The new side spans its seam gutter too, so an under-row beside it
  // clears the same columns its cells do.
  const sideColumns = SPLIT_SIDE_COLUMNS + seamColumns;
  const columnCount = gutterColumns + SPLIT_SIDE_COLUMNS + sideColumns;

  return (
    <tbody
      data-tokens={tokensPending ? "pending" : undefined}
      data-view="split"
    >
      {pairs.map((pair) => {
        if (pair.full !== undefined) {
          const { line, index } = pair.full;
          return (
            <Fragment key={pair.key}>
              {beforeRow?.(line, index, columnCount)}
              <tr className={rowStyles["line"]} data-line-kind={line.kind}>
                {fullRow?.(line, index, columnCount) ?? (
                  <td colSpan={columnCount}>{line.content}</td>
                )}
              </tr>
            </Fragment>
          );
        }

        const lead = pair.right ?? pair.left;
        if (lead === undefined) {
          return null;
        }
        // A gap can open at either unified index the pair covers, once each.
        const before: { cell: SplitCell; side: SplitSide }[] = [];
        if (pair.left !== undefined) {
          before.push({ cell: pair.left, side: SplitSides.LEFT });
        }
        if (pair.right !== undefined && pair.right !== pair.left) {
          before.push({ cell: pair.right, side: SplitSides.RIGHT });
        }
        const leftAttributes = readSideAttributes(
          rowAttributes,
          pair.left,
          SplitSides.LEFT,
        );
        const rightAttributes = readSideAttributes(
          rowAttributes,
          pair.right,
          SplitSides.RIGHT,
        );

        return (
          <Fragment key={pair.key}>
            {before.map(({ cell, side }) => (
              <Fragment key={side}>
                {beforeRow?.(cell.line, cell.index, columnCount)}
              </Fragment>
            ))}
            <tr className={`${rowStyles["line"]} ${styles["pair"]}`}>
              {gutterCell?.(lead.line, lead.index)}
              <SideCells
                anchorAttributes={anchorAttributes}
                lineNumberAttributes={lineNumberAttributes}
                attributes={leftAttributes}
                cell={pair.left}
                codeTrailer={codeTrailer}
                lineNumberContent={lineNumberContent}
                side={SplitSides.LEFT}
                emphasisByRow={emphasisByRow}
                tokensByRow={tokensByRow}
              />
              {seamCell?.(lead.line, lead.index)}
              <SideCells
                anchorAttributes={anchorAttributes}
                lineNumberAttributes={lineNumberAttributes}
                attributes={rightAttributes}
                cell={pair.right}
                codeTrailer={codeTrailer}
                lineNumberContent={lineNumberContent}
                side={SplitSides.RIGHT}
                emphasisByRow={emphasisByRow}
                tokensByRow={tokensByRow}
              />
            </tr>
            {pair.left !== undefined && pair.left !== pair.right
              ? underRow?.(
                  pair.left.line,
                  pair.left.index,
                  columnCount,
                  sideColumns,
                )
              : null}
            {pair.right !== undefined
              ? underRow?.(
                  pair.right.line,
                  pair.right.index,
                  columnCount,
                  sideColumns,
                )
              : null}
          </Fragment>
        );
      })}
      {trailingRow?.(columnCount)}
    </tbody>
  );
}

function readSideAttributes(
  slot: DiffRowAttributeSlot | undefined,
  cell: SplitCell | undefined,
  side: SplitSide,
): DiffRowAttributes {
  if (slot === undefined || cell === undefined) {
    return NO_ATTRIBUTES;
  }

  return slot(cell.line, cell.index, side);
}

interface SideCellsProps {
  cell: SplitCell | undefined;
  side: SplitSide;
  attributes: DiffRowAttributes;
  tokensByRow: RowTokenMap | undefined;
  emphasisByRow: EmphasisByRow | undefined;
  codeTrailer: DiffRowSlot | undefined;
  lineNumberContent: DiffNumberCellSlot | undefined;
  anchorAttributes: Record<string, string>;
  lineNumberAttributes: Record<string, string>;
}

function SideCells({
  cell,
  side,
  attributes,
  tokensByRow,
  emphasisByRow,
  codeTrailer,
  lineNumberContent,
  anchorAttributes,
  lineNumberAttributes,
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
  const lineSide: DiffSide =
    side === SplitSides.LEFT ? DiffSides.OLD : DiffSides.NEW;
  const number = side === SplitSides.LEFT ? line.oldLine : line.newLine;
  const numberContent = lineNumberContent?.(line, index, lineSide);
  const selected = attributes.selected ? "" : undefined;
  const commentable = attributes.commentable ? "" : undefined;
  const focusable = attributes.focusable;

  return (
    <>
      <td
        className={rowStyles["lineNumber"]}
        {...lineNumberAttributes}
        data-commentable={commentable}
        data-line-kind={line.kind}
        data-line-number=""
        data-line-old={side === SplitSides.LEFT ? number : undefined}
        data-line-new={side === SplitSides.RIGHT ? number : undefined}
        data-line-origin={line.origin}
        data-pick={attributes.pick}
        data-selected={selected}
        data-side={side}
        data-state={numberContent ? NumberCellStates.COVERED : undefined}
        onMouseDown={attributes.onMouseDown}
        onMouseEnter={attributes.onMouseEnter}
        onMouseUp={attributes.onMouseUp}
      >
        <span className={rowStyles["digits"]}>
          {number ?? ""}
          {numberContent}
        </span>
      </td>
      <td
        aria-describedby={attributes.describedById}
        aria-disabled={attributes.disabled ? true : undefined}
        className={rowStyles["code"]}
        data-commentable={commentable}
        data-line-kind={line.kind}
        data-line-origin={line.origin}
        data-pick={attributes.pick}
        data-rev={attributes.revision}
        data-selected={selected}
        data-side={side}
        onKeyDown={(event) => {
          hopAcrossSides(event);
          attributes.onKeyDown?.(event);
        }}
        onMouseDown={attributes.onMouseDown}
        onMouseEnter={attributes.onMouseEnter}
        onMouseUp={attributes.onMouseUp}
        tabIndex={focusable ? 0 : ARROW_ONLY_STOP}
      >
        <span className={rowStyles["sign"]} {...anchorAttributes}>
          {DIFF_LINE_SIGNS[line.kind]}
        </span>
        <DiffCodeText
          content={line.content}
          emphasis={emphasisByRow?.get(index)}
          tokens={tokensByRow?.get(index)}
        />
        {codeTrailer?.(line, index)}
      </td>
    </>
  );
}

const HOP_KEYS: Record<string, SplitSide> = {
  ArrowLeft: SplitSides.LEFT,
  ArrowRight: SplitSides.RIGHT,
};

/** Left and Right move focus to the other side's line cell on the same row. */
function hopAcrossSides(event: KeyboardEvent<HTMLTableCellElement>): void {
  const target = HOP_KEYS[event.key];
  if (target === undefined) {
    return;
  }
  // A modified arrow belongs to the reader's assistive tech or the browser's
  // own selection chords, and a hop to the side already focused is not a hop:
  // taking either would swallow a key this row has no business claiming.
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (event.currentTarget.dataset["side"] === target) {
    return;
  }

  const row = event.currentTarget.closest("tr");
  const cell = row?.querySelector<HTMLElement>(
    `td[data-side="${target}"][tabindex]`,
  );
  if (cell === null || cell === undefined) {
    return;
  }

  event.preventDefault();
  cell.focus();
}
