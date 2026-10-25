import type { PrConversation } from "../../types";
import { isStatedVerdict } from "../../utils/filter";
import type { TFunction } from "i18next";

interface JumpSpot {
  currentHeadSha: string;
  anchorSha: string;
  focusThreadId: number | undefined;
  threadId: number;
}

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

/**
 * A jump that changes neither the revision nor the thread leaves the URL as
 * it is, so nothing re-renders the landing: the section has to land again.
 */
export function shouldRelandInPlace(spot: JumpSpot): boolean {
  if (spot.currentHeadSha !== spot.anchorSha) {
    return false;
  }
  return spot.focusThreadId === spot.threadId;
}
