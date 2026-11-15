import type { Mutable } from "types";

import type { MentionSource, PrConversation } from "../../types";
import { DigestRowKinds, type DigestRow } from "../../utils/digest";
import {
  applyConversationFilter,
  isStatedVerdict,
  type ConversationFilter,
} from "../../utils/filter";
import type { ThreadComposerWiring } from "../../wiring";
import type { ConversationPlan } from "./types";

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

/** One count on the bar's head; the threads part carries its open count too. */
export interface HeadSummaryPart {
  i18nKey:
    | "conversation.summaryReviews"
    | "conversation.summaryComments"
    | "conversation.summaryThreadsCounted"
    | "conversation.summaryAfterBrief";
  count: number;
  open?: number;
}

/**
 * Header totals with zero parts omitted, "0 threads" next to a visible
 * review reads as an undercount. Nothing to count = no parts at all.
 */
export function listHeadSummaryParts(
  conversation: PrConversation,
  afterBriefCount: number,
): HeadSummaryPart[] {
  const reviews = conversation.reviews.filter(isStatedVerdict).length;
  const comments = conversation.prComments.length;
  const threads = conversation.threads.length;
  const parts: HeadSummaryPart[] = [];
  if (reviews > 0) {
    parts.push({ i18nKey: "conversation.summaryReviews", count: reviews });
  }
  if (comments > 0) {
    parts.push({ i18nKey: "conversation.summaryComments", count: comments });
  }
  if (threads > 0) {
    const open = conversation.threads.filter(
      (thread) => !thread.isResolved,
    ).length;
    parts.push({
      i18nKey: "conversation.summaryThreadsCounted",
      count: threads,
      open,
    });
  }
  if (afterBriefCount > 0) {
    parts.push({
      i18nKey: "conversation.summaryAfterBrief",
      count: afterBriefCount,
    });
  }
  return parts;
}

/**
 * The conversation as the filter leaves it, with a landing target kept in.
 * A `?thread=` target is exempt: filter keys persist in the URL, so a
 * filtered-out target would make the jump silently do nothing.
 */
export function filterForLanding(
  conversation: PrConversation,
  filter: ConversationFilter,
  focusThreadId: number | undefined,
): PrConversation {
  const filtered = applyConversationFilter(conversation, filter);
  if (focusThreadId === undefined) {
    return filtered;
  }
  const alreadyIn = filtered.threads.some(
    (thread) => thread.rootCommentId === focusThreadId,
  );
  if (alreadyIn) {
    return filtered;
  }

  const target = conversation.threads.find(
    (thread) => thread.rootCommentId === focusThreadId,
  );
  return target === undefined
    ? filtered
    : { ...filtered, threads: [...filtered.threads, target] };
}

/** True when the row is the thread's own, or a bot group holding it. */
export function holdsThread(row: DigestRow, threadId: number): boolean {
  if (row.kind === DigestRowKinds.THREAD) {
    return row.thread.rootCommentId === threadId;
  }
  return row.threads.some((nested) => nested.thread.rootCommentId === threadId);
}

export interface ThreadComposerInput {
  plan: ConversationPlan;
  readOnlyReason: string | undefined;
  mentionSource: MentionSource;
  focusThreadId: number | undefined;
  refresh: () => void;
  relandInPlace: () => void;
}

/**
 * The wiring a thread's composer writes through. Every conversation write
 * evicts server-side, so a post and a resolution flip both refetch; draft
 * reads and writes and announce copy live inside ReplyComposer.
 */
export function buildThreadComposer(
  input: ThreadComposerInput,
): ThreadComposerWiring {
  const { plan, refresh, focusThreadId, relandInPlace } = input;
  const composer: Mutable<ThreadComposerWiring> = {
    post: plan.postReply,
    onPosted: refresh,
    mentionSource: input.mentionSource,
  };
  if (input.readOnlyReason !== undefined) {
    composer.readOnlyReason = input.readOnlyReason;
  }
  if (plan.revisionJump !== undefined) {
    const revisionJump = plan.revisionJump;
    composer.revisionJump = {
      ...revisionJump,
      onJump: (anchorSha, threadId) => {
        const spot = {
          currentHeadSha: revisionJump.currentHeadSha,
          anchorSha,
          focusThreadId,
          threadId,
        };
        if (shouldRelandInPlace(spot)) {
          relandInPlace();
        }
        revisionJump.onJump(anchorSha, threadId);
      },
    };
  }
  // A row's slim/full transition comes from this section's refetch, never a local edit.
  if (plan.resolution !== undefined) {
    composer.resolution = { ...plan.resolution, refetchConversation: refresh };
  }
  return composer;
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
