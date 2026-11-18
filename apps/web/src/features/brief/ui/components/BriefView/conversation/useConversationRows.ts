import { useMemo } from "react";

import type { UseConversationRowsValue } from "../types";
import type { UseConversationRowsInput } from "./types";
import {
  deriveConversationByChunk,
  deriveConversationFilterFacets,
  deriveHiddenThreadsByFile,
  deriveLineThreadsByFile,
  deriveUnfilteredDigestInput,
} from "./utils";

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

  const conversationByChunk = useMemo(
    () =>
      deriveConversationByChunk({
        conversationData,
        conversationFilter,
        readingOrderedChunks,
        submittedReviewIds,
        briefGeneratedAt,
      }),
    [
      conversationData,
      conversationFilter,
      readingOrderedChunks,
      submittedReviewIds,
      briefGeneratedAt,
    ],
  );

  const unfilteredInput = useMemo(
    () =>
      deriveUnfilteredDigestInput({
        conversationData,
        readingOrderedChunks,
        submittedReviewIds,
        briefGeneratedAt,
      }),
    [
      conversationData,
      readingOrderedChunks,
      submittedReviewIds,
      briefGeneratedAt,
    ],
  );

  const hiddenThreadsByFile = useMemo(
    () => deriveHiddenThreadsByFile(unfilteredInput),
    [unfilteredInput],
  );

  const lineThreadsByFile = useMemo(
    () => deriveLineThreadsByFile(unfilteredInput),
    [unfilteredInput],
  );

  // The Filter disclosure renders in the toolbar ABOVE the section and
  // outside its collapsed body, so the facets are computed here.
  const conversationFilterFacets = useMemo(
    () =>
      deriveConversationFilterFacets({
        conversationData,
        conversationFilter,
        readingOrderedChunks,
      }),
    [conversationData, conversationFilter, readingOrderedChunks],
  );

  return {
    conversationByChunk,
    hiddenThreadsByFile,
    lineThreadsByFile,
    conversationFilterFacets,
  };
}
