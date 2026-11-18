import type { ValueOf, DiffSide } from "types";
import type {
  CSSProperties,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
} from "react";
import type {
  DiffLine,
  RowToken,
  RowTokenMap,
} from "@web/utils/diffTokens/types";

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

/** A row's standing while a pick mode waits for lines: `data-pick`. */
export const DiffRowPicks = {
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
} as const;
export type DiffRowPick = ValueOf<typeof DiffRowPicks>;

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

/** One line number on one side of the diff, as a number cell shows it. */
export interface LineOnSide {
  side: DiffSide;
  line: number;
}

/**
 * A line the reader can focus, named for the column the arrow keys step it
 * within: a unified `row`, or a split side. Tab enters a table on any stop
 * but an `-arrow` one, which is reached from another stop only.
 */
export const LineStops = {
  ROW: "row",
  LEFT: "left",
  RIGHT: "right",
  LEFT_ARROW: "left-arrow",
  RIGHT_ARROW: "right-arrow",
} as const;
export type LineStop = ValueOf<typeof LineStops>;

/** A number cell whose slot content stands in for the digits it covers. */
export const NumberCellStates = {
  COVERED: "covered",
} as const;

/** Content inside the number cell showing a line on `side`, after the number. */
export type DiffNumberCellSlot = (
  row: DiffLine,
  index: number,
  side: DiffSide,
) => ReactNode;

/** A whole row of the caller's own: hunk headers and expansion controls. */
export type DiffFullRowSlot = (
  row: DiffLine,
  index: number,
  columnCount: number,
) => ReactNode;

/** A row placed before one of the diff's rows, or after the last. */
export type DiffEdgeRowSlot = (columnCount: number) => ReactNode;

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
  pick?: DiffRowPick | undefined;
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
  /** Changed character runs per row against its paired line. */
  emphasisByRow?: EmphasisByRow | undefined;
  /** Tokens are on their way: the code text holds its space but stays unpainted. */
  tokensPending?: boolean;
  /**
   * Leading cell per row: exactly one `<td>` for every row that has columns,
   * never null, because the column count is fixed for the whole table. Rows
   * that span it (hunk and note) never call the slot.
   */
  gutterCell?: DiffRowSlot;
  /**
   * Split view only: one `<td>` between the halves, before the new side's
   * number, for every row that has columns. Absent leaves the halves flush.
   */
  seamCell?: DiffRowSlot | undefined;
  /** Trails the code text inside the code cell. */
  codeTrailer?: DiffRowSlot;
  /** Trails the number inside each number cell. */
  lineNumberContent?: DiffNumberCellSlot;
  /** Full-width rows rendered under one row, threads and composers today. */
  underRow?: DiffUnderRowSlot;
  /**
   * Replaces the plain spanning cell of a hunk or note row; null keeps the
   * plain cell. The row's `<tr>` and kind attribute stay with DiffRows.
   */
  fullRow?: DiffFullRowSlot;
  /** A whole row before the row at this index; null renders nothing. */
  beforeRow?: DiffFullRowSlot;
  /** A whole row after the last row; null renders nothing. */
  trailingRow?: DiffEdgeRowSlot;
  /** Line-number columns. Chunk-less rows carry no numbers to show. */
  lineNumbers?: boolean;
  rowAttributes?: DiffRowAttributeSlot;
  /**
   * Marks the sign column as the composer's drag handle, never the code
   * text. Data keys only, and spread before the cell's own props, so it
   * cannot take over className or a handler.
   */
  anchorAttributes?: Record<`data-${string}`, string>;
  /** The same for the line-number cells, which drive line selection. */
  lineNumberAttributes?: Record<`data-${string}`, string>;
}

/** Character offsets into a row's text, `to` exclusive. */
export interface CharRange {
  from: number;
  to: number;
}

export interface PairedEmphasis {
  left: CharRange[];
  right: CharRange[];
}

/** One side of a pair: its text, and its tokens when the worker gave any. */
export interface TokenSide {
  text: string;
  tokens?: readonly RowToken[] | undefined;
}

export type EmphasisByRow = ReadonlyMap<number, readonly CharRange[]>;

/** A code cell's leading-whitespace width in columns, which the phone wrap hangs continuation lines under. */
export interface CodeIndentStyle extends CSSProperties {
  "--code-indent": number;
}
