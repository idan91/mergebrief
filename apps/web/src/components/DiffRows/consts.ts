import { DiffRowOrigins } from "@web/utils/diffTokens/types";
import type { PairedEmphasis } from "./types";
import { type DiffSide, DiffSides } from "types/comments";

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

// `data-line-origin`, `data-side`, `data-line-old` and `data-line-new` are
// written by DiffRows and SplitRows and read back only through the
// selectors below. A rename touches both render sites and every string here.
export const EXPANDED_ORIGIN_SELECTOR = `[data-line-origin="${DiffRowOrigins.EXPANDED}"]`;
/** A row or cell the PR diff carried: the origin attribute is absent. */
export const DIFF_ORIGIN_SELECTOR = ":not([data-line-origin])";
export const EXPANDED_ROW_SELECTOR = `tr${EXPANDED_ORIGIN_SELECTOR}`;
/** The right-side number cell of an expanded split row; its code cell follows it. */
export const EXPANDED_RIGHT_NUMBER_SELECTOR = `td[data-side="right"]${EXPANDED_ORIGIN_SELECTOR}[data-line-number]`;

/** The line a number cell shows per side; read back only by `buildLineCellSelector`. */
export const LINE_ATTRIBUTES: Record<DiffSide, string> = {
  [DiffSides.OLD]: "data-line-old",
  [DiffSides.NEW]: "data-line-new",
};
