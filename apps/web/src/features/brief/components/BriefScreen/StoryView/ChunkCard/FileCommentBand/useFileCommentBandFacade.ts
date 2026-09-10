import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  demotedSubmittedCommentIds,
  type DigestThreadRow,
} from "@web/features/conversation/utils";
import {
  useFileReviewComments,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import { createFileCommentAnchor } from "@web/features/review/utils";
import type { BriefChunk } from "../../../../../types";

const EMPTY_EXPANDED_THREADS: ReadonlySet<number> = new Set();

export interface UseFileCommentBandFacadeInput {
  chunk: BriefChunk;
  composerOpen: boolean;
  inboundRows: readonly DigestThreadRow[];
}

export function useFileCommentBandFacade({
  chunk,
  composerOpen,
  inboundRows,
}: UseFileCommentBandFacadeInput) {
  const [collapsed, setCollapsed] = useState(false);
  const fileComments = useFileReviewComments(chunk.file);
  const {
    saveComment,
    deleteComment,
    toggleComment,
    updateComment,
    toggleConversationThread,
  } = useReviewActions();
  const composerSaving = useReviewFlow((state) => state.composerSaving);
  const postComment = useReviewFlow((state) => state.postComment);
  const postBlockedExternally = useReviewFlow(
    (state) => state.postBlockedExternally,
  );
  const ownInbound = useMemo(
    () => inboundRows.filter((row) => row.isOwn).map((row) => row.thread),
    [inboundRows],
  );
  const comments = useMemo(() => {
    if (ownInbound.length === 0) return fileComments;
    const demoted = demotedSubmittedCommentIds(fileComments, ownInbound);
    if (demoted.size === 0) return fileComments;
    return fileComments.filter((comment) => !demoted.has(comment.id));
  }, [fileComments, ownInbound]);
  const postingCommentIds = useReviewFlow(
    useShallow((state) =>
      comments
        .filter((comment) => state.postingCommentIds.has(comment.id))
        .map((comment) => comment.id),
    ),
  );
  const chunkKey = `${chunk.file}#${chunk.id}`;
  const expandedConversation =
    useReviewFlow((state) => state.expandedConversations.get(chunkKey)) ??
    EMPTY_EXPANDED_THREADS;

  useEffect(() => {
    if (composerOpen) setCollapsed(false);
  }, [composerOpen]);

  const hasSaved = comments.length > 0 || inboundRows.length > 0;
  const visible = composerOpen || hasSaved;
  const showBody = composerOpen || !collapsed;
  const fileAnchor = createFileCommentAnchor(chunk.file);

  return {
    collapsed,
    comments,
    composerSaving,
    expandedConversation,
    fileAnchor,
    hasSaved,
    postingCommentIds,
    postBlockedExternally,
    postComment,
    showBody,
    visible,
    chunkKey,
    deleteComment,
    saveComment,
    toggleCollapsed: () => {
      if (composerOpen) return;
      setCollapsed((current) => !current);
    },
    toggleComment,
    toggleConversationThread,
    updateComment,
  };
}
