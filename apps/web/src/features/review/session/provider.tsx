import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { BriefViewModel } from "@web/features/brief/utils";
import type { ReviewComment } from "../utils/comments";
import {
  createReviewSessionStore,
  type ReviewSessionActions,
  type ReviewSessionStore,
  type ReviewSessionStoreValue,
} from "./store";
import { sessionInitialState, type ReviewSessionPayload } from "./serverState";

const ReviewSessionContext = createContext<ReviewSessionStore | null>(null);

interface ReviewSessionProviderProps {
  briefId: string;
  model: BriefViewModel;
  /**
   * The server-held session, read by the route loader. Absent = no session to
   * show (a file-backed Brief, or a read that failed), and the screen is
   * read-only.
   */
  session?: ReviewSessionPayload | undefined;
  children: ReactNode;
}

/**
 * Per-brief client runtime of the Review Session. The store is created once
 * per mount (never a module singleton), so it is SSR-safe and per-brief
 * isolated, mirroring the per-request queryClient. Its contents are the
 * server's: the loader read them, and every action writes them back.
 *
 * The provider is NOT remounted per brief: a revision change swaps `briefId`
 * in place, and the render-phase switch below re-derives the store before any
 * child renders against the new model. An effect would be too late: one frame
 * of the old brief's ids against the new model's flags/groups is a crash, not
 * a flicker.
 */
export function ReviewSessionProvider({
  briefId,
  model,
  session,
  children,
}: ReviewSessionProviderProps) {
  const storeRef = useRef<ReviewSessionStore | null>(null);
  storeRef.current ??= createReviewSessionStore(
    sessionInitialState(model, session),
  );
  const store = storeRef.current;
  const mountedBriefId = useRef(briefId);
  const appliedSession = useRef(session);

  // Render-phase re-derive (guarded, so it runs once per change and never on
  // the server, where neither input can change within the single render pass).
  // The session is re-applied on IDENTITY change, not just on a brief switch:
  // a read that lands after the first paint — the degraded route recovering —
  // must reach the store, or writes would come back on over a screen still
  // showing none of the reviewer's earlier work. react-query's structural
  // sharing keeps the reference stable while the payload is unchanged, so an
  // unchanged refetch re-derives nothing.
  if (
    mountedBriefId.current !== briefId ||
    appliedSession.current !== session
  ) {
    mountedBriefId.current = briefId;
    appliedSession.current = session;
    store.setState(sessionInitialState(model, session));
  }

  return (
    <ReviewSessionContext.Provider value={store}>
      {children}
    </ReviewSessionContext.Provider>
  );
}

export function useReviewSession<T>(
  selector: (state: ReviewSessionStoreValue) => T,
): T {
  const store = useContext(ReviewSessionContext);
  if (!store) throw new Error("ReviewSessionProvider is missing");
  return useStore(store, selector);
}

export function useReviewSessionActions(): ReviewSessionActions {
  return useReviewSession((state) => state.actions);
}

/**
 * The chunk-scoped slice of the session's review comments. `useShallow`
 * keeps the returned array identity stable while the chunk's own comments
 * are reference-unchanged, so a memoized consumer re-renders only when its
 * slice changes — not on every comment interaction elsewhere.
 */
export function useChunkReviewComments(chunkId: string): ReviewComment[] {
  return useReviewSession(
    useShallow((state) =>
      state.reviewComments.filter(
        (comment) => comment.anchor.chunkId === chunkId,
      ),
    ),
  );
}
