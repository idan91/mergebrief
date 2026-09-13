import type { KeyboardEventHandler, MouseEventHandler, ReactNode } from "react";
import type { DiffLine } from "@web/utils/diffTokens/types";

/** Content a composer hangs off one row, given that row and its index. */
export type DiffRowSlot = (row: DiffLine, index: number) => ReactNode;

/** Under-row content; `columnCount` is what a full-width cell must span. */
export type DiffUnderRowSlot = (
  row: DiffLine,
  index: number,
  columnCount: number,
) => ReactNode;

/**
 * What a composer puts on one row's `<tr>`. The class and the kind attribute
 * stay with DiffRows, which owns the rules that read them.
 */
export interface DiffRowAttributes {
  describedById?: string;
  disabled?: boolean;
  commentable?: boolean;
  /** `data-rev`: this row's standing in a revision comparison. */
  revision?: string | undefined;
  selected?: boolean;
  focusable?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLTableRowElement>;
  onMouseDown?: MouseEventHandler<HTMLTableRowElement>;
  onMouseEnter?: MouseEventHandler<HTMLTableRowElement>;
  onMouseUp?: MouseEventHandler<HTMLTableRowElement>;
}

export type DiffRowAttributeSlot = (
  row: DiffLine,
  index: number,
) => DiffRowAttributes;

export interface DiffRowsProps {
  rows: DiffLine[];
  /**
   * Leading cell per row: exactly one `<td>` for every row that has columns,
   * never null, because the column count is fixed for the whole table. Rows
   * that span it (hunk and note) never call the slot.
   */
  gutterCell?: DiffRowSlot;
  /** Trails the code text inside the code cell. */
  codeTrailer?: DiffRowSlot;
  /** Full-width rows rendered under one row, threads and composers today. */
  underRow?: DiffUnderRowSlot;
  /** Line-number columns. Chunk-less rows carry no numbers to show. */
  lineNumbers?: boolean;
  rowAttributes?: DiffRowAttributeSlot;
  /**
   * Marks the cells a composer may treat as a drag handle: the line numbers
   * and the sign column, never the code text. Data keys only, and spread
   * before the cell's own props, so it cannot take over className or a
   * handler.
   */
  anchorAttributes?: Record<`data-${string}`, string>;
}
