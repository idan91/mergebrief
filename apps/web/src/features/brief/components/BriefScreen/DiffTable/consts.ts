import type { DiffLine } from "@web/utils/diffTokens/types";
import type { SplitRow } from "@web/components/DiffRows/types";
import type { DragSelection } from "./types";

export const EMPTY_REVIEW_COMMENTS: never[] = [];

export const NO_PAIRS: SplitRow[] = [];

// A zero-width space keeps the empty side of an under-row a real cell.
export const EMPTY_GAP = "\u200B";

export const NO_DIFF: DiffLine[] = [];

/** Marks the cells range anchoring may start from, read by the row handlers. */
export const COMMENT_ANCHOR_ATTRIBUTES = { "data-comment-anchor": "" };

export const EMPTY_EXPANDED_THREADS: ReadonlySet<number> = new Set();

export const NO_SELECTION: DragSelection = {
  indexes: [],
  placement: undefined,
};
