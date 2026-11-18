/** Lines drawn as elements at most; a repeating fill draws the rest of the well. */
export const MAX_SKELETON_ROWS = 400;

/** Indent levels by code row, a fixed cycle so a re-render never reshuffles the skeleton. */
export const INDENT_RHYTHM = [
  1, 1, 2, 2, 3, 3, 3, 2, 2, 1, 2, 3, 4, 4, 3, 2, 1, 0, 1, 2,
];

/** Columns one indent level takes. */
export const INDENT_STEP = 2;

/** Where in its bucket a row's width falls, by row, a fixed cycle. */
export const WIDTH_FRACTIONS = [
  0.55, 0.9, 0.3, 0.75, 0.12, 0.65, 0.95, 0.45, 0.8, 0.2,
];

/** How much narrower a paired row's other side is than its wider one, a fixed cycle. */
export const PAIRED_SIDE_FRACTIONS = [0.7, 0.45, 0.9, 0.6, 0.8];

/** Hunk header widths in columns, a fixed cycle. */
export const HEADER_COLUMNS = [62, 48, 71, 55, 66, 44];

/** A note row's text width in columns. */
export const NOTE_COLUMNS = 28;

/** The narrowest a wrapped row's last line is drawn, so the wrap reads as one. */
export const MIN_TAIL_COLUMNS = 6;

/** Strides that walk the rows' widths in a spread order; the first coprime with the row count wins. */
export const WIDTH_STRIDES = [7, 11, 13, 17, 19, 23];

/** The fewest digits a line number column is drawn for. */
export const MIN_LINE_DIGITS = 2;

/** A code row's width in columns where the histogram has no entry for it. */
export const FALLBACK_ROW_COLUMNS = 20;

/** A padding row's width spread past `FALLBACK_ROW_COLUMNS`, stepped by row key. */
export const PADDING_WIDTH_STRIDE = 13;
export const PADDING_WIDTH_SPREAD = 40;

/** Added to a row's width fraction, so a row spans half to one and a half of its bucket's edge. */
export const BUCKET_WIDTH_OFFSET = 0.5;

/** Columns a code bar keeps past its indent. */
export const MIN_INDENTED_BAR = 4;

/** The narrowest bar split into tokens; a narrower one draws as one. */
export const MIN_TOKENED_COLUMNS = 12;

/** The first token's width: the minimum plus a spread stepped by the row's seed. */
export const MIN_FIRST_TOKEN = 3;
export const FIRST_TOKEN_SPREAD = 4;

/** The second token's share of the bar: the minimum plus up to nine steps by seed. */
export const MIN_SECOND_TOKEN_SHARE = 0.28;
export const SECOND_TOKEN_SHARE_STEP = 0.02;
export const SECOND_TOKEN_STEPS = 10;
export const SECOND_TOKEN_SEED_STRIDE = 7;

/** The narrowest second token, and the fewest columns a third one keeps. */
export const MIN_SECOND_TOKEN = 4;
export const MIN_LAST_TOKEN = 3;
