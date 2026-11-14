/**
 * Notion writes one id with or without dashes and in either letter case.
 * Every comparison of two ids reads both sides through this: a board id from
 * the tracker list, a page's parent, a page's own id.
 */
export function normalizeNotionId(id: string): string {
  return id.replaceAll("-", "").toLowerCase();
}
