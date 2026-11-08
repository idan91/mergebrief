import { useCallback, useEffect, useRef, type RefObject } from "react";

import {
  isHostingFileComposer,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import { createFileCommentAnchor } from "@web/features/review/utils";
import { useReviewPosture } from "../../../../hooks/useReviewPosture";
import type { BriefChunk } from "../../../../../model/types";
import { useReadingPositionIfMounted } from "../../reading/reading-position";

export interface UseFileCommentComposerInput {
  chunk: BriefChunk;
  chunkOpen: boolean;
  toggleChunk: (chunkId: string) => void;
}

export interface FileCommentComposer {
  bandRef: RefObject<HTMLElement | null>;
  composerOpen: boolean;
  requestComposer: () => void;
  revealComposer: () => void;
  cancelComposer: () => void;
}

export function useFileCommentComposer({
  chunk,
  chunkOpen,
  toggleChunk,
}: UseFileCommentComposerInput): FileCommentComposer {
  const composerOpen = useReviewFlow((state) =>
    isHostingFileComposer(state.composer, chunk.id),
  );
  const { openComposer, cancelComposer } = useReviewActions();
  const { composerDisabledReason } = useReviewPosture();

  const bandRef = useRef<HTMLElement | null>(null);

  const requestComposer = useCallback(() => {
    if (composerOpen) {
      cancelComposer();
      return;
    }
    const opensChunk = !chunkOpen && composerDisabledReason === undefined;
    if (opensChunk) {
      toggleChunk(chunk.id);
    }
    openComposer(
      createFileCommentAnchor(chunk.file),
      composerDisabledReason,
      chunk.id,
    );
  }, [
    cancelComposer,
    chunk.file,
    chunk.id,
    chunkOpen,
    composerDisabledReason,
    composerOpen,
    openComposer,
    toggleChunk,
  ]);

  /** The way in from a menu, which has no pressed state to toggle: an open composer takes focus instead of closing. */
  const revealComposer = useCallback(() => {
    if (composerOpen) {
      bandRef.current?.querySelector("textarea")?.focus();
      return;
    }
    requestComposer();
  }, [composerOpen, requestComposer]);

  const requested = useReadingPositionIfMounted(
    (state) => state.fileCommentChunkId === chunk.id,
  );
  const clearRequest = useReadingPositionIfMounted(
    (state) => state.actions.clearFileCommentRequest,
  );

  useEffect(() => {
    if (requested) {
      clearRequest();
      revealComposer();
    }
  }, [clearRequest, requested, revealComposer]);

  return {
    bandRef,
    composerOpen,
    requestComposer,
    revealComposer,
    cancelComposer,
  };
}
