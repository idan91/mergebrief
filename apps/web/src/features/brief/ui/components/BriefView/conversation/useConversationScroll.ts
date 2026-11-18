import { useCallback } from "react";

import { deriveScrollMotion } from "../scroll-to-target/engine/plan";
import {
  ScrollMotions,
  ScrollPlacements,
} from "../scroll-to-target/engine/types";
import {
  ScrollHistories,
  ScrollTargetKinds,
  type JumpToChunkFromConversation,
  type ScrollTargetOptions,
} from "../scroll-to-target/types";
import type { UseConversationScrollInput } from "./types";

/** A row target renders only on an open card; the scroll focuses and flashes it. */
const ROW_SCROLL: ScrollTargetOptions = {
  motion: ScrollMotions.SMOOTH,
  history: ScrollHistories.NONE,
  open: true,
  focus: true,
  flash: true,
  placement: ScrollPlacements.READING_BAND,
};

/** A card's head rests under the pinned stack, where a chunk jump puts it. */
const CARD_SCROLL: ScrollTargetOptions = {
  ...ROW_SCROLL,
  placement: ScrollPlacements.UNDER_STACK,
};

export function useConversationScroll({
  scrollToTarget,
  setActiveChunk,
}: UseConversationScrollInput): JumpToChunkFromConversation {
  return useCallback<JumpToChunkFromConversation>(
    (chunkId, target, behavior = "smooth", history = ScrollHistories.NONE) => {
      setActiveChunk(chunkId);
      if (target !== undefined) {
        return scrollToTarget(
          { kind: ScrollTargetKinds.ROW, chunkId, row: target },
          { ...ROW_SCROLL, history },
        );
      }

      const motion = deriveScrollMotion(behavior);
      return scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId },
        { ...CARD_SCROLL, motion, history },
      );
    },
    [scrollToTarget, setActiveChunk],
  );
}
