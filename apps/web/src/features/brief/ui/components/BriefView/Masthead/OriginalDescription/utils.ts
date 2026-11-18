const WHITESPACE_RUN = /\s+/;

/** Words in the description as written; blank text has none. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") {
    return 0;
  }
  const words = trimmed.split(WHITESPACE_RUN);
  return words.length;
}
