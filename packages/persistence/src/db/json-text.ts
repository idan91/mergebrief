const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);
/**
 * One JSON escape at a time, left to right, so an escaped backslash is consumed
 * whole and the text after it is never read as an escape. A valid surrogate pair
 * matches as one unit. Migration 0088 walks stored rows the same way.
 */
const JSON_ESCAPE =
  /\\u(?:0000|d[89ab][0-9a-f]{2}(?:\\ud[c-f][0-9a-f]{2})?|d[c-f][0-9a-f]{2})|\\[\s\S]/gi;
const UNSTORABLE_ESCAPE = /^\\u(?:0000|d[89a-f][0-9a-f]{2})$/i;

/**
 * Text a later `::jsonb` cast can read. One NUL or lone surrogate would fail
 * that cast, and a migration holding it would stop the instance at boot. Those
 * characters become U+FFFD and every other byte stays as it was. Whether the text
 * is JSON at all is the column's CHECK to decide.
 */
export function cleanJsonText(text: string): string {
  const cleaned = text.replaceAll(JSON_ESCAPE, (escape) =>
    UNSTORABLE_ESCAPE.test(escape) ? REPLACEMENT_CHARACTER : escape,
  );
  return cleaned.toWellFormed();
}
