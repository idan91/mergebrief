// Curated utils entry: the conversation vocabulary other features read.
// Internal conversation files import the modules directly.
export {
  buildInlineThreads,
  buildLineThreadsByFile,
  buildThreadsOutsideChunks,
  splitInlineRows,
  DigestRowKinds,
  type BuildConversationDigestInput,
  type DigestRow,
  type DigestThreadRow,
} from "./digest";
export {
  applyConversationFilter,
  conversationFilterSearch,
  countHiddenInlineThreads,
  DEFAULT_CONVERSATION_FILTER,
  isFilterActive,
  parseConversationFilter,
  reconcileReviewers,
  reviewerFacets,
  verdictFacets,
  type ConversationFilter,
  type ConversationFilterSearch,
  type ReviewerFacet,
  type VerdictFacet,
} from "./filter";
export {
  demotedSubmittedCommentIds,
  reconcileOwnComments,
} from "./ownComments";
export { isKnownAnchor, ThreadPlacementKinds } from "./anchor";
