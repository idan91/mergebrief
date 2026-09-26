import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { DigestThreadRow } from "@web/features/conversation/utils";
import { isLineCommentAnchor } from "@web/features/review/utils";
import {
  useChunkReviewComments,
  useReviewActions,
  useReviewCommentsForChunks,
  useReviewFlow,
} from "@web/features/review/session";
import type { BriefChunk } from "../../../types";
import { EMPTY_EXPANDED_THREADS, EMPTY_REVIEW_COMMENTS } from "./consts";
import { demoteSubmitted } from "./utils";

export interface DiffTableCommentsInput {
  chunk: BriefChunk;
  /** Store-owned key for this table's expanded threads; file-qualified. */
  chunkKey: string;
  readOnlyReason: string | undefined;
  spanOwnerIds: readonly string[];
  conversationThreadsByRow: ReadonlyMap<number, DigestThreadRow[]> | undefined;
  fileThreads: readonly DigestThreadRow[];
}

/**
 * The review-flow slice one table reads: its own and its span owners'
 * comments with the server-backed ones demoted, the composer it hosts,
 * and the post affordances. Every stateful read is chunk-scoped so this
 * table re-renders for ITS composer and posts only, never a sibling's.
 */
export function useDiffTableComments({
  chunk,
  chunkKey,
  readOnlyReason,
  spanOwnerIds,
  conversationThreadsByRow,
  fileThreads,
}: DiffTableCommentsInput) {
  const readOnly = readOnlyReason !== undefined;
  const {
    openComposer,
    cancelComposer,
    saveComment,
    deleteComment,
    toggleComment,
    toggleConversationThread,
    updateComment,
    announce,
    announceQuietly,
    selectLines,
    clearLineSelection,
  } = useReviewActions();
  const chunkComments = useChunkReviewComments(chunk.id);
  const allComments = readOnly ? EMPTY_REVIEW_COMMENTS : chunkComments;
  const ownerComments = useReviewCommentsForChunks(spanOwnerIds);
  const allSpanComments = readOnly ? EMPTY_REVIEW_COMMENTS : ownerComments;
  // Server-backed wins: once a posted comment's own GitHub thread renders in
  // this chunk, the local submitted card demotes out of display. With no
  // conversation loaded there are no own threads, so local cards stay.
  const ownChunkThreads = useMemo(
    () =>
      [...(conversationThreadsByRow?.values() ?? [])]
        .flat()
        .filter((row) => row.isOwn)
        .map((row) => row.thread),
    [conversationThreadsByRow],
  );
  const comments = useMemo(
    () => demoteSubmitted(allComments, ownChunkThreads),
    [allComments, ownChunkThreads],
  );
  // A span shows the owners' threads too, so the same demotion applies.
  const ownFileThreads = useMemo(
    () => fileThreads.filter((row) => row.isOwn).map((row) => row.thread),
    [fileThreads],
  );
  const spanComments = useMemo(
    () => demoteSubmitted(allSpanComments, ownFileThreads),
    [allSpanComments, ownFileThreads],
  );
  // Anchor-match selector: null (stable) unless the composer is hosted by
  // THIS table. A span row's composer anchors to the owner but opens here.
  const composerSaving = useReviewFlow((state) => state.composerSaving);
  const anchorForChunk = useReviewFlow((state) => {
    const anchor = state.composerAnchor;
    if (anchor === null || !isLineCommentAnchor(anchor)) return null;
    return state.composerHost === chunk.id ? anchor : null;
  });
  const activeCommentAnchor = readOnly ? null : anchorForChunk;
  // Chunk-scoped: a selection elsewhere never re-renders this table.
  const lineSelection = useReviewFlow((state) =>
    state.lineSelection?.chunkId === chunk.id ? state.lineSelection : null,
  );
  // While a draft waits for its new lines, every row pick places it.
  const reanchorArmed = useReviewFlow(
    (state) => state.reanchorDraftId !== null,
  );
  /**
   * Why comment composition is disabled. When set, commentable rows stay
   * focusable but carry `aria-disabled` + an `aria-describedby` reason, and
   * selection/composer entry is inert.
   */
  const postureDisabledReason = useReviewFlow(
    (state) => state.composerDisabledReason,
  );
  const composerDisabledReason = readOnlyReason ?? postureDisabledReason;
  // Post a staged draft now; undefined hides the Post affordance entirely.
  const postComment = useReviewFlow((state) => state.postComment);
  const postReviewComment = readOnly ? undefined : postComment;
  // Wait-shaped reason every Post is blocked right now (submit in flight).
  const postBlockedExternally = useReviewFlow(
    (state) => state.postBlockedExternally,
  );
  // In-flight post-now ids scoped to THIS chunk's comments (the registry's
  // set covers the whole brief, so an unscoped read would re-render every
  // expanded table on any post).
  const postingCommentIds = useReviewFlow(
    useShallow((state) =>
      comments
        .filter((comment) => state.postingCommentIds.has(comment.id))
        .map((comment) => comment.id),
    ),
  );
  // Store-owned so it survives this card unmounting offscreen.
  const expandedConversation =
    useReviewFlow((state) => state.expandedConversations.get(chunkKey)) ??
    EMPTY_EXPANDED_THREADS;

  return {
    openComposer,
    cancelComposer,
    saveComment,
    deleteComment,
    toggleComment,
    toggleConversationThread,
    updateComment,
    announce,
    announceQuietly,
    selectLines,
    clearLineSelection,
    lineSelection,
    reanchorArmed,
    comments,
    spanComments,
    composerSaving,
    activeCommentAnchor,
    composerDisabledReason,
    postReviewComment,
    postBlockedExternally,
    postingCommentIds,
    expandedConversation,
  };
}
