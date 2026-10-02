import type { GroupSummarySegment } from "./types";

const INLINE_CODE = /`([^`]+)`/g;

/** Backtick spans become code segments; everything else stays prose. */
export function splitInlineCode(text: string): GroupSummarySegment[] {
  const segments: GroupSummarySegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_CODE)) {
    const [whole, code] = match;
    if (match.index > cursor) {
      segments.push({
        offset: cursor,
        text: text.slice(cursor, match.index),
        code: false,
      });
    }
    segments.push({ offset: match.index, text: code ?? "", code: true });
    cursor = match.index + whole.length;
  }

  if (cursor < text.length) {
    segments.push({ offset: cursor, text: text.slice(cursor), code: false });
  }
  return segments;
}
