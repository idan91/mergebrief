import { useEffect, useMemo, useState } from "react";
import { CommentAnchorKinds } from "types/comments";

import {
  demotedSubmittedCommentIds,
  type DigestThreadRow,
} from "@web/features/conversation/utils";
import {
  isHostSaving,
  useFileReviewComments,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import { createFileCommentAnchor } from "@web/features/review/utils";
import { useReviewPosture } from "../../../../../hooks/useReviewPosture";
import { useComposerHost } from "../../../hooks/useComposerHost";
import type { BriefChunk } from "../../../../../../model/types";

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
  useComposerHost(CommentAnchorKinds.FILE, chunk.id);
  const fileComments = useFileReviewComments(chunk.file);
  const {
    saveComment,
    deleteComment,
    toggleComment,
    updateComment,
    toggleConversationThread,
  } = useReviewActions();
  const composerSaving = useReviewFlow((state) =>
    isHostSaving(state.composer, chunk.id),
  );
  const {
    postComment,
    postBlockedExternally,
    postingCommentIds: postingInBrief,
  } = useReviewPosture();
  const ownInbound = useMemo(
    () => inboundRows.filter((row) => row.isOwn).map((row) => row.thread),
    [inboundRows],
  );
  const comments = useMemo(() => {
    if (ownInbound.length === 0) {
      return fileComments;
    }
    const demoted = demotedSubmittedCommentIds(fileComments, ownInbound);
    if (demoted.size === 0) {
      return fileComments;
    }
    return fileComments.filter((comment) => !demoted.has(comment.id));
  }, [fileComments, ownInbound]);
  const postingCommentIds = comments
    .filter((comment) => postingInBrief.has(comment.id))
    .map((comment) => comment.id);
  const chunkKey = `${chunk.file}#${chunk.id}`;
  const expandedConversation =
    useReviewFlow((state) => state.expandedConversations.get(chunkKey)) ??
    EMPTY_EXPANDED_THREADS;

  useEffect(() => {
    if (composerOpen) {
      setCollapsed(false);
    }
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
      if (composerOpen) {
        return;
      }
      setCollapsed((current) => !current);
    },
    toggleComment,
    toggleConversationThread,
    updateComment,
  };
}
