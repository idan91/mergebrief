import type { PrConversation } from "../../types";
import { isStatedVerdict } from "../../utils/filter";
import type { TFunction } from "i18next";

/**
 * Header totals with zero parts omitted, "0 threads" next to a visible
 * review reads as an undercount. Nothing to count = no summary at all.
 */
export function headSummary(
  t: TFunction,
  conversation: PrConversation,
): string | undefined {
  const reviews = conversation.reviews.filter(isStatedVerdict).length;
  const comments = conversation.prComments.length;
  const threads = conversation.threads.length;
  const parts: string[] = [];
  if (reviews > 0) {
    parts.push(t("conversation.summaryReviews", { count: reviews }));
  }
  if (comments > 0) {
    parts.push(t("conversation.summaryComments", { count: comments }));
  }
  if (threads > 0) {
    const open = conversation.threads.filter(
      (thread) => !thread.isResolved,
    ).length;
    parts.push(t("conversation.summaryThreads", { count: threads, open }));
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}
