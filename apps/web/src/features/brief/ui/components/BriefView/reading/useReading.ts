import { useCallback, useMemo, useRef } from "react";

import { useCreateExpansionStore } from "../../../../model/expansion/useExpansion";
import type { ExpansionSource } from "../../../../model/expansion/useExpansionSource";
import { useRevisionNavigation } from "../../../hooks/useRevisionNavigation";
import { ScrollPlacements } from "../scroll-to-target/engine/types";
import { useCreateBriefViewStore } from "../store";
import type { ReadingState, UseReadingInput } from "../types";
import { createChunkWindowRegistry } from "./chunk-windows";
import { useCreateReadingPositionStore } from "./reading-position";
import { scrollPageToTop } from "./scroll-to-top";
import { useReadingSession } from "./useReadingSession";

export function useReading({
  props,
  overlay,
  ownDraftActive,
}: UseReadingInput): ReadingState {
  const { reading, address, pr } = props;
  const { brief, briefId, model, repoConfig } = reading;
  const repoId = pr?.repoId;

  const chunkWindowsRef = useRef(createChunkWindowRegistry());
  const readingPosition = useCreateReadingPositionStore(briefId);
  const expansion = useCreateExpansionStore(briefId);
  const viewStore = useCreateBriefViewStore(briefId, {
    model,
    initialFocusMode: address.searchParams.focus === true,
  });
  const session = useReadingSession({
    brief,
    briefId,
    compareViewFull: overlay.compareState.view === "full",
    model,
    ownDraftActive,
    repoConfig,
    chunkWindows: chunkWindowsRef.current,
    exitChangesScope: address.exitChangesScope,
    position: readingPosition,
    viewStore,
  });

  // A chunk jump from a group's own controls puts the card's head under the
  // pinned stack, where the conversation's card scroll rests too. Keyed on
  // the stable jump, not the session object, so the memoized group cards
  // that take it keep their boundary.
  const sessionJumpToChunk = session.jumpToChunk;
  const jumpToChunkUnderStack = useCallback(
    (chunkId: string, behavior?: ScrollBehavior) =>
      sessionJumpToChunk(chunkId, behavior, ScrollPlacements.UNDER_STACK),
    [sessionJumpToChunk],
  );
  // Hunk-edge expansion reads the file at the head sha through the pull's
  // API route; the local path has no route, so its edges stay folded.
  const expansionSource = useMemo((): ExpansionSource | undefined => {
    if (repoId === undefined) {
      return undefined;
    }
    return { repoId, prNumber: brief.pr.number, ref: brief.pr.sha };
  }, [repoId, brief.pr.number, brief.pr.sha]);
  const revisionNav = useRevisionNavigation({
    chunks: session.readingOrderedChunks,
    marks: overlay.comparison.marks,
    getActiveChunkId: () => readingPosition.getState().activeChunkId,
    scrollToTarget: session.scrollToTarget,
  });

  const scrollToTop = useCallback(() => {
    scrollPageToTop(chunkWindowsRef.current);
  }, []);

  return {
    chunkWindowsRef,
    scrollToTop,
    readingPosition,
    expansion,
    viewStore,
    session,
    jumpToChunkUnderStack,
    expansionSource,
    revisionNav,
  };
}
