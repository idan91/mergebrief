import { DiffRowOrigins } from "@web/utils/diffTokens/types";
import type { LineSide, PairedEmphasis } from "./types";

/** Past this many tokens on a side the whole line is the change; no emphasis. */
export const INTRA_LINE_TOKEN_CAP = 200;
/** Past this many characters on a side a ring is unreadable; no emphasis. */
export const INTRA_LINE_CHARACTER_CAP = 1_000;
/** Emphasis covering more of a side than this reads as noise; none is drawn. */
export const INTRA_LINE_EMPHASIS_SHARE = 0.7;

export const NO_EMPHASIS: PairedEmphasis = { left: [], right: [] };

/** Above this many middle-token products the LCS is not worth its cost. */
export const LCS_CELL_CAP = 10_000;
/** An unchanged token this short, all punctuation or space, joins the runs around it. */
export const INTRA_LINE_BRIDGE_LENGTH = 2;

/**
 * `data-line-origin`, `data-line-number` and `data-side` are written by
 * DiffRows and SplitRows and read back only through the selectors below,
 * which find the row or cell showing a line. A rename touches both render
 * sites and every string here together.
 */
export const EXPANDED_ORIGIN_SELECTOR = `[data-line-origin="${DiffRowOrigins.EXPANDED}"]`;
/** A row or cell the PR diff carried: the origin attribute is absent. */
export const DIFF_ORIGIN_SELECTOR = ":not([data-line-origin])";
export const EXPANDED_ROW_SELECTOR = `tr${EXPANDED_ORIGIN_SELECTOR}`;
/** The right-side number cell of an expanded split row; its code cell follows it. */
export const EXPANDED_RIGHT_NUMBER_SELECTOR = `td[data-side="right"]${EXPANDED_ORIGIN_SELECTOR}[data-line-number]`;

export const LINE_NUMBER_SELECTOR = "[data-line-number]";
export const SIDE_NUMBER_SELECTORS: Record<LineSide, string> = {
  old: 'td[data-side="left"][data-line-number]',
  new: 'td[data-side="right"][data-line-number]',
};
export const UNIFIED_NUMBER_POSITIONS: Record<LineSide, number> = {
  old: 0,
  new: 1,
};
