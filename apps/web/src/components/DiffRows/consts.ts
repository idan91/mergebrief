import type { PairedEmphasis } from "./types";

/** Past this many tokens on a side the whole line is the change; no emphasis. */
export const INTRA_LINE_TOKEN_CAP = 200;
/** Past this many characters on a side a ring is unreadable; no emphasis. */
export const INTRA_LINE_CHARACTER_CAP = 1_000;
/** Emphasis covering more of a side than this reads as noise; none is drawn. */
export const INTRA_LINE_EMPHASIS_SHARE = 0.7;

export const NO_EMPHASIS: PairedEmphasis = { left: [], right: [] };

/** Above this many middle-token products the LCS is not worth its cost. */
export const LCS_CELL_CAP = 10_000;
