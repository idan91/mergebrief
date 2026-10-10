import { useCallback } from "react";

import {
  LandHistories,
  LandMotions,
  LandPlacements,
  LandTargetKinds,
  type LandOptions,
} from "../landing/types";
import { deriveLandMotion } from "../landing/utils";
import type {
  JumpToChunkFromConversation,
  UseConversationLandingInput,
} from "./types";

/** A row target renders only on an open card; the landing focuses and flashes it. */
const ROW_LANDING: LandOptions = {
  motion: LandMotions.SMOOTH,
  history: LandHistories.NONE,
  open: true,
  focus: true,
  flash: true,
  placement: LandPlacements.READING_BAND,
};

/** A card's head rests under the pinned stack, where a chunk jump puts it. */
const CARD_LANDING: LandOptions = {
  ...ROW_LANDING,
  placement: LandPlacements.UNDER_STACK,
};

/** The digest-to-diff jump: a row when the target names one, else the card. */
export function useConversationLanding({
  land,
  setActiveChunk,
}: UseConversationLandingInput): JumpToChunkFromConversation {
  return useCallback<JumpToChunkFromConversation>(
    (chunkId, target, behavior = "smooth", history = LandHistories.NONE) => {
      setActiveChunk(chunkId);
      if (target !== undefined) {
        return land(
          { kind: LandTargetKinds.ROW, chunkId, row: target },
          { ...ROW_LANDING, history },
        );
      }

      const motion = deriveLandMotion(behavior);
      return land(
        { kind: LandTargetKinds.CHUNK, chunkId },
        { ...CARD_LANDING, motion, history },
      );
    },
    [land, setActiveChunk],
  );
}
