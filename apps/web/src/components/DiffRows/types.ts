import type { ValueOf } from "types";
import type { KeyboardEventHandler, MouseEventHandler, ReactNode } from "react";
import type { DiffLine, RowTokenMap } from "@web/utils/diffTokens/types";

export const DiffViews = {
  UNIFIED: "unified",
  SPLIT: "split",
} as const;
export type DiffView = ValueOf<typeof DiffViews>;

export const SplitSides = {
  LEFT: "left",
  RIGHT: "right",
} as const;
export type SplitSide = ValueOf<typeof SplitSides>;

/** One side of a paired row; `index` is the row's place in the unified diff. */
export interface SplitCell {
  line: DiffLine;
  index: number;
}

/** A hunk or note row spans both sides; a context row sits on both. */
export interface SplitRow {
  key: string;
  full?: SplitCell;
  left?: SplitCell;
  right?: SplitCell;
}

/** Content a composer hangs off one row, given that row and its index. */
export type DiffRowSlot = (row: DiffLine, index: number) => ReactNode;

/** Under-row content; `columnCount` is what a full-width cell must span. */
export type DiffUnderRowSlot = (
  row: DiffLine,
  index: number,
  columnCount: number,
  /** Present in the split view: the columns one side spans. */
  sideColumns?: number,
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
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onMouseDown?: MouseEventHandler<HTMLElement>;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseUp?: MouseEventHandler<HTMLElement>;
}

export type DiffRowAttributeSlot = (
  row: DiffLine,
  index: number,
  /** Present in the split view: which side of the pair asks. */
  side?: SplitSide,
) => DiffRowAttributes;

export interface DiffRowsProps {
  rows: DiffLine[];
  /** Unified rows, or sides paired per hunk on one row each. */
  view?: DiffView;
  /** The pairs for the split view, built once by the caller. */
  pairs?: SplitRow[] | undefined;
  /** Syntax tokens keyed by row index; a row without an entry renders plain. */
  tokensByRow?: RowTokenMap | undefined;
  /** Tokens are on their way: the code text holds its space but stays unpainted. */
  tokensPending?: boolean;
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
