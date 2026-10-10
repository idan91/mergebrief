import { useCallback, useState } from "react";

import { useReviewActions } from "@web/features/review/session";
import { createFileCommentAnchor } from "@web/features/review/utils";
import { useReviewPosture } from "../../../../hooks/useReviewPosture";
import type { BriefChunk } from "../../../../../model/types";

export interface UseFileCommentComposerInput {
  chunk: BriefChunk;
  chunkOpen: boolean;
  toggleChunk: (chunkId: string) => void;
}

export function useFileCommentComposer({
  chunk,
  chunkOpen,
  toggleChunk,
}: UseFileCommentComposerInput) {
  const [composerOpen, setComposerOpen] = useState(false);
  const { openComposer } = useReviewActions();
  const { composerDisabledReason } = useReviewPosture();

  const cancelComposer = useCallback(() => setComposerOpen(false), []);

  const requestComposer = useCallback(() => {
    if (composerDisabledReason !== undefined) {
      openComposer(createFileCommentAnchor(chunk.file), composerDisabledReason);
      return;
    }
    if (composerOpen) {
      setComposerOpen(false);
      return;
    }
    if (!chunkOpen) {
      toggleChunk(chunk.id);
    }
    setComposerOpen(true);
  }, [
    chunk.file,
    chunk.id,
    chunkOpen,
    composerDisabledReason,
    composerOpen,
    openComposer,
    toggleChunk,
  ]);

  return {
    composerOpen,
    requestComposer,
    cancelComposer,
  };
}
