// The conversation's threads as the diff renders them: inline under their
// chunk, by file for expanded rows, and the facets the Filter draws from.
import { useMemo } from "react";

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
} from "@web/features/conversation/utils";
import type {
  UseConversationRowsInput,
  UseConversationRowsValue,
} from "./types";

// Ownership is the review-id join alone. Local comments feed only the pointer
// and resurrection outputs, so they stay OUT of every dep list here: a comment
// save or toggle must not rebuild each chunk's inline rows and bust the
// ChunkCard memo boundary.
const NO_LOCAL_COMMENTS: [] = [];

export function useConversationRows(
  input: UseConversationRowsInput,
): UseConversationRowsValue {
  const {
    conversationData,
    conversationFilter,
    readingOrderedChunks,
    submittedReviewIds,
    briefGeneratedAt,
  } = input;

  // The filter reaches the diff too: a reviewer chip that left their inline
  // threads in place would answer "who said what" only halfway.
  const conversationByChunk = useMemo(() => {
    if (conversationData === undefined) return undefined;
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
  }, [
    conversationData,
    conversationFilter,
    readingOrderedChunks,
    submittedReviewIds,
    briefGeneratedAt,
  ]);

  // Unfiltered on purpose: a hidden thread is hidden whoever wrote it, and
  // an expansion surfaces it the same way.
  const unfilteredInput = useMemo(() => {
    if (conversationData === undefined) return undefined;
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
  }, [
    conversationData,
    readingOrderedChunks,
    submittedReviewIds,
    briefGeneratedAt,
  ]);

  const hiddenThreadsByFile = useMemo(
    () =>
      unfilteredInput === undefined
        ? undefined
        : buildThreadsOutsideChunks(unfilteredInput),
    [unfilteredInput],
  );

  const lineThreadsByFile = useMemo(
    () =>
      unfilteredInput === undefined
        ? undefined
        : buildLineThreadsByFile(unfilteredInput),
    [unfilteredInput],
  );

  // The Filter disclosure renders in the toolbar ABOVE the section and
  // outside its collapsed body, so the facets are computed here. Reconciled
  // first, so the counts describe the same conversation the section and the
  // diff render.
  const conversationFilterFacets = useMemo(() => {
    if (conversationData === undefined) return undefined;
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
  }, [conversationData, conversationFilter, readingOrderedChunks]);

  return {
    conversationByChunk,
    hiddenThreadsByFile,
    lineThreadsByFile,
    conversationFilterFacets,
  };
}
