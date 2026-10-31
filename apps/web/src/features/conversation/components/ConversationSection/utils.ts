import type { PrConversation } from "../../types";
import { isStatedVerdict } from "../../utils/filter";
import type { TFunction } from "i18next";

/** Input that hands the scroll back to the reader. */
const READER_INPUT_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "pointerdown",
] as const;

/** A smooth scroll sends a scroll event every frame; this long without one, it has ended. */
const SCROLL_QUIET_MS = 150;

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

/**
 * Marks a smooth scroll in flight until it ends, the reader takes over, or no
 * scroll event arrives for a while: a row already in place scrolls nowhere and
 * sends no `scrollend`, and a browser without `scrollend` only goes quiet.
 */
export function markSmoothScroll(beginSmoothScroll: () => () => void): void {
  const endSmoothScroll = beginSmoothScroll();
  const listening = new AbortController();
  const listenerOptions = { passive: true, signal: listening.signal };
  let quietTimer = window.setTimeout(release, SCROLL_QUIET_MS);
  function release(): void {
    listening.abort();
    window.clearTimeout(quietTimer);
    endSmoothScroll();
  }

  window.addEventListener(
    "scroll",
    () => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(release, SCROLL_QUIET_MS);
    },
    listenerOptions,
  );
  window.addEventListener("scrollend", release, listenerOptions);
  for (const type of READER_INPUT_EVENTS) {
    window.addEventListener(type, release, listenerOptions);
  }
}
