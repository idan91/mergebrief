import type { PrConversation } from "../../types";
import { isStatedVerdict } from "../../utils/filter";

/**
 * Header totals with zero parts omitted — "0 threads" next to a visible
 * review reads as an undercount. Nothing to count = no summary at all.
 */
export function headSummary(conversation: PrConversation): string | undefined {
  const reviews = conversation.reviews.filter(isStatedVerdict).length;
  const comments = conversation.prComments.length;
  const threads = conversation.threads.length;
  const parts: string[] = [];
  if (reviews > 0) {
    parts.push(`${reviews} review${reviews === 1 ? "" : "s"}`);
  }
  if (comments > 0) {
    parts.push(`${comments} comment${comments === 1 ? "" : "s"}`);
  }
  if (threads > 0) {
    const open = conversation.threads.filter(
      (thread) => !thread.isResolved,
    ).length;
    parts.push(`${threads} thread${threads === 1 ? "" : "s"} · ${open} open`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}
