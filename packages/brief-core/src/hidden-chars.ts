/** Invisible to a reader, read by a model: zero-width, bidi, variation selectors, Unicode tags. */
export const HIDDEN_CHARS =
  /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;

/** The hidden set plus control characters and line separators, which a path may hold and a reader cannot see as themselves. */
const PATH_HIDDEN_CHARS =
  /[\p{Cc}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;

/**
 * What can drive a terminal or reorder prose: C0 and C1 controls, the line
 * and paragraph separators, and the bidi embeddings, overrides and isolates.
 * The bidi marks (LRM, RLM, ALM) and emoji joiners stay: right-to-left text
 * and emoji carry them, and none reorders text past its neighbours.
 */
const TEXT_HIDDEN_CHARS = /[\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/gu;

/** What can drive a terminal or hide code. A joiner stays out of the exemptions: `isAd\u200Dmin` is a legal identifier that reads as `isAdmin`. */
const DIFF_LINE_HIDDEN_CHARS =
  /(?!\t)[\p{Cc}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

function formatCodePoint(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return `[U+${code.toString(16).toUpperCase().padStart(4, "0")}]`;
}

export function escapeHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARS, formatCodePoint);
}

/** What a person reads for a title or other prose; a key or match keeps the raw text. */
export function formatDisplayText(text: string): string {
  return text.replace(TEXT_HIDDEN_CHARS, formatCodePoint);
}

/** One line of a diff as a terminal shows it; machine output keeps the raw bytes. */
export function formatDisplayDiffLine(line: string): string {
  return line.replace(DIFF_LINE_HIDDEN_CHARS, formatCodePoint);
}

/** What a person reads for a path; a lookup, link or key keeps the raw path. */
export function formatDisplayPath(path: string): string {
  return path.replace(PATH_HIDDEN_CHARS, formatCodePoint);
}
