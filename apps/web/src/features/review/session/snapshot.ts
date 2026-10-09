import type { ChangeGroupCategory } from "types";
import type { ReviewComment } from "../utils/comments";
import type { ReviewOutcome } from "../utils/state";
import type { Disposition } from "./disposition";
import type { ReviewSessionState } from "./store";

/**
 * The frozen, serializable projection of the session, Sets flattened to
 * arrays. The Receipt builder's input, and nothing else: the session itself
 * lives on the server, never in browser storage.
 */
export interface SessionSnapshot {
  briefId: string;
  dispositions: Record<string, Disposition>;
  dominants: Record<string, ChangeGroupCategory>;
  reclassifiedGroupIds: string[];
  reviewedChunkIds: string[];
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
  submittedReviewIds?: number[];
}

export function serializeSnapshot(
  briefId: string,
  state: Omit<
    ReviewSessionState,
    "unplacedDrafts" | "carriedFrom" | "attention"
  >,
): SessionSnapshot {
  return {
    briefId,
    dispositions: state.dispositions,
    dominants: state.dominants,
    reclassifiedGroupIds: [...state.reclassifiedGroups],
    reviewedChunkIds: [...state.reviewedChunks],
    reviewComments: state.reviewComments,
    reviewOutcome: state.reviewOutcome,
    submittedReviewIds: [...state.submittedReviewIds],
  };
}
