import { useMemo } from "react";

import type { DigestThreadRow } from "@web/features/conversation/utils";
import {
  findDraftComment,
  type LineCommentAnchor,
} from "@web/features/review/utils";
import {
  getHostedLineAnchor,
  getReanchorDraftId,
  isHostSaving,
  useChunkReviewComments,
  useReviewActions,
  useReviewCommentsForChunks,
  useReviewFlow,
  useReviewSession,
} from "@web/features/review/session";
import { useReviewPosture } from "../../../hooks/useReviewPosture";
import type { BriefChunk } from "../../../../model/types";
import { EMPTY_EXPANDED_THREADS } from "./consts";
import { demoteSubmitted, isNewSideAnchor } from "./utils";

export interface DiffTableCommentsInput {
  chunk: BriefChunk;
  /** Store-owned key for this table's expanded threads; file-qualified. */
  chunkKey: string;
  /** The table hosts guest rows: a selection on one of its owners is its own. */
  isGuest: boolean;
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
  isGuest,
  spanOwnerIds,
  conversationThreadsByRow,
  fileThreads,
}: DiffTableCommentsInput) {
  const {
    openComposer: openComposerAction,
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
  const allComments = useChunkReviewComments(chunk.id);
  const allSpanComments = useReviewCommentsForChunks(spanOwnerIds);
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
  // Host-scoped: absent unless THIS table shows the composer, so a
  // sibling's composer or save never re-renders it. A span row's composer
  // anchors to the owner but opens here.
  const composerSaving = useReviewFlow((state) =>
    isHostSaving(state.composer, chunk.id),
  );
  const activeCommentAnchor = useReviewFlow((state) =>
    getHostedLineAnchor(state.composer, chunk.id),
  );
  // Chunk-scoped: a selection elsewhere never re-renders this table. A
  // guest selection names the owner, so a guest table reads its owners'.
  const lineSelection = useReviewFlow((state) => {
    const selection = state.lineSelection;
    if (selection === null) {
      return null;
    }
    if (selection.chunkId === chunk.id) {
      return selection;
    }
    const ownersSelection =
      isGuest &&
      spanOwnerIds.includes(selection.chunkId) &&
      isNewSideAnchor(selection);

    return ownersSelection ? selection : null;
  });
  // While a draft waits for its new lines, a row pick in its file places
  // it and every other file's rows stand inert. Keyed on the draft still
  // existing, as the banner is: a draft deleted while armed ends the mode.
  const reanchorDraftId = useReviewFlow((state) =>
    getReanchorDraftId(state.composer),
  );
  const reanchorFile = useReviewSession(
    (state) =>
      findDraftComment(state.reviewComments, reanchorDraftId)?.anchor.file,
  );
  const reanchorArmed = reanchorFile === chunk.file;
  const reanchorElsewhere = reanchorFile !== undefined && !reanchorArmed;
  /**
   * Why comment composition is disabled. When set, commentable rows stay
   * focusable but carry `aria-disabled` + an `aria-describedby` reason, and
   * selection/composer entry is inert.
   */
  const {
    composerDisabledReason,
    postComment: postReviewComment,
    postBlockedExternally,
    postingCommentIds: postingInBrief,
  } = useReviewPosture();
  const postingCommentIds = comments
    .concat(spanComments)
    .filter((comment) => postingInBrief.has(comment.id))
    .map((comment) => comment.id);
  function openComposer(anchor: LineCommentAnchor, hostChunkId: string): void {
    openComposerAction(anchor, composerDisabledReason, hostChunkId);
  }
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
    reanchorElsewhere,
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
