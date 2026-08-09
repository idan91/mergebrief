// Thread-state chip derivations, shared by the section digest and the
// promoted ThreadRowView. Chips carry TEXT (WCAG 1.4.1) and stay factual —
// `resolved` never dresses as success.
import type { DigestRow } from "./digest";
import type { ConversationThread } from "../types";

/**
 * GitHub facts wear GitHub words. A resolved+outdated thread reads as
 * outdated — that is why it left the code view.
 */
export function threadStateChip(thread: ConversationThread): string {
  if (thread.isOutdated) return "outdated";
  return thread.isResolved ? "resolved" : "open";
}

/**
 * The collapsed bot-group chip must stay factual for the WHOLE group: an
 * all-outdated group reads outdated even when its threads are unresolved
 * (outdated is WHY they left the code view); otherwise open wins over
 * resolved.
 */
export function botGroupChip(
  row: Extract<DigestRow, { kind: "bot-group" }>,
): string {
  if (row.threads.every((threadRow) => threadRow.thread.isOutdated)) {
    return "outdated";
  }
  return row.openCount > 0 ? "open" : "resolved";
}
