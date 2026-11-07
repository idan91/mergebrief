import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useReviewActions } from "@web/features/review/session";
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
  const [composerOpen, setComposerOpen] = useState(false);
  const { openComposer } = useReviewActions();
  const { composerDisabledReason } = useReviewPosture();

  const bandRef = useRef<HTMLElement | null>(null);

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

  /** The way in from a menu, which has no pressed state to toggle: an open composer keeps its text. */
  const revealComposer = useCallback(() => {
    const composerInCollapsedChunk = composerOpen && !chunkOpen;
    if (composerInCollapsedChunk) {
      toggleChunk(chunk.id);
      return;
    }
    if (composerOpen) {
      bandRef.current?.querySelector("textarea")?.focus();
      return;
    }
    requestComposer();
  }, [chunk.id, chunkOpen, composerOpen, requestComposer, toggleChunk]);

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
