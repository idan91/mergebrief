import { createContext, useContext, type ReactNode } from "react";

import type { ReviewComment } from "@web/features/review/utils";

/**
 * What the reviewer may do on this screen right now. The screen derives it
 * each render from its route plans and in-flight gates; readers see a change
 * in the same render that made it.
 */
export interface ReviewPosture {
  /** Why comment affordances are read-only; undefined when writable. */
  composerDisabledReason: string | undefined;
  /** Risk flags render as a read-only mirror. */
  flagsReadOnly: boolean;
  /** Comment ids with a post-now request in flight. */
  postingCommentIds: ReadonlySet<string>;
  /** Why every Post is blocked right now, such as a Submit in flight. */
  postBlockedExternally: string | undefined;
  /** Posts a staged draft against the current head; undefined hides Post. */
  postComment: ((comment: ReviewComment) => void) | undefined;
}

const ReviewPostureContext = createContext<ReviewPosture | null>(null);

export interface ReviewPostureProviderProps {
  posture: ReviewPosture;
  children: ReactNode;
}

export function ReviewPostureProvider({
  posture,
  children,
}: ReviewPostureProviderProps) {
  return (
    <ReviewPostureContext.Provider value={posture}>
      {children}
    </ReviewPostureContext.Provider>
  );
}

export function useReviewPosture(): ReviewPosture {
  const posture = useContext(ReviewPostureContext);
  if (posture === null) {
    throw new Error("ReviewPostureProvider is missing");
  }
  return posture;
}
