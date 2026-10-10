import {
  applyConversationFilter,
  buildInlineThreads,
  buildLineThreadsByFile,
  buildThreadsOutsideChunks,
  countHiddenInlineThreads,
  DEFAULT_CONVERSATION_FILTER,
  reconcileOwnComments,
  reconcileReviewers,
  reviewerFacets,
  verdictFacets,
  type BuildConversationDigestInput,
  type DigestRow,
  type DigestThreadRow,
} from "@web/features/conversation/utils";
import type { ConversationFilterFacets } from "../types";
import type { UseConversationRowsInput } from "./types";

// Ownership is the review-id join alone. Local comments feed only the pointer
// and resurrection outputs, so no row derivation here takes them: a comment
// save or toggle must not rebuild each chunk's inline rows and bust the
// ChunkCard memo boundary.
const NO_LOCAL_COMMENTS: [] = [];

/**
 * The heading exists whether or not the section is expanded, so focus and
 * scroll reach it a frame later, after the expand has rendered.
 */
export function focusConversationHeading(): void {
  window.requestAnimationFrame(() => {
    const heading = document.getElementById("conversation-heading");
    if (!(heading instanceof HTMLElement)) {
      return;
    }
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  });
}

/**
 * The filter reaches the diff too: a reviewer chip that left their inline
 * threads in place would answer "who said what" only halfway.
 */
export function deriveConversationByChunk({
  conversationData,
  conversationFilter,
  readingOrderedChunks,
  submittedReviewIds,
  briefGeneratedAt,
}: UseConversationRowsInput): Map<string, DigestRow[]> | undefined {
  if (conversationData === undefined) {
    return undefined;
  }
  const filtered = applyConversationFilter(
    conversationData,
    reconcileReviewers(
      conversationFilter ?? DEFAULT_CONVERSATION_FILTER,
      conversationData,
    ),
  );
  const { ownThreadIds, ownReviewIds } = reconcileOwnComments(
    NO_LOCAL_COMMENTS,
    filtered.threads,
    submittedReviewIds,
  );
  return buildInlineThreads({
    conversation: filtered,
    chunks: readingOrderedChunks,
    ownThreadIds,
    briefGeneratedAt,
    ownReviewIds,
  });
}

/**
 * Unfiltered on purpose: a hidden thread is hidden whoever wrote it, and an
 * expansion surfaces it the same way.
 */
export function deriveUnfilteredDigestInput({
  conversationData,
  readingOrderedChunks,
  submittedReviewIds,
  briefGeneratedAt,
}: Omit<UseConversationRowsInput, "conversationFilter">):
  | BuildConversationDigestInput
  | undefined {
  if (conversationData === undefined) {
    return undefined;
  }
  const { ownThreadIds, ownReviewIds } = reconcileOwnComments(
    NO_LOCAL_COMMENTS,
    conversationData.threads,
    submittedReviewIds,
  );
  return {
    conversation: conversationData,
    chunks: readingOrderedChunks,
    ownThreadIds,
    briefGeneratedAt,
    ownReviewIds,
  };
}

export function deriveHiddenThreadsByFile(
  unfilteredInput: BuildConversationDigestInput | undefined,
): Map<string, DigestThreadRow[]> | undefined {
  return unfilteredInput === undefined
    ? undefined
    : buildThreadsOutsideChunks(unfilteredInput);
}

export function deriveLineThreadsByFile(
  unfilteredInput: BuildConversationDigestInput | undefined,
): Map<string, DigestThreadRow[]> | undefined {
  return unfilteredInput === undefined
    ? undefined
    : buildLineThreadsByFile(unfilteredInput);
}

/**
 * Reconciled first, so the counts describe the same conversation the section
 * and the diff render.
 */
export function deriveConversationFilterFacets({
  conversationData,
  conversationFilter,
  readingOrderedChunks,
}: Pick<
  UseConversationRowsInput,
  "conversationData" | "conversationFilter" | "readingOrderedChunks"
>): ConversationFilterFacets | undefined {
  if (conversationData === undefined) {
    return undefined;
  }
  const applied = reconcileReviewers(
    conversationFilter ?? DEFAULT_CONVERSATION_FILTER,
    conversationData,
  );
  return {
    verdicts: verdictFacets(conversationData, applied),
    reviewers: reviewerFacets(conversationData),
    hiddenInlineThreads: countHiddenInlineThreads(
      conversationData,
      applied,
      readingOrderedChunks,
    ),
    applied,
  };
}
