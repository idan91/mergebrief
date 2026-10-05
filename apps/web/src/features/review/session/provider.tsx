import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { BriefViewModel } from "@web/features/brief/utils";
import {
  countDraftComments,
  isFileCommentAnchor,
  isLineCommentAnchor,
  type ReviewComment,
} from "../utils/comments";
import {
  createReviewSessionStore,
  type ReviewSessionActions,
  type ReviewSessionStore,
  type ReviewSessionStoreValue,
} from "./store";
import {
  sessionInitialState,
  type ReviewSessionPayload,
  type UnplacedDrafts,
} from "./serverState";
import {
  createSessionWriteGateway,
  type SessionWriteGateway,
} from "./writeGateway";
import type { SessionWrites } from "./writes";

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
  /**
   * The session write transport. Absent = no writes wired (the local
   * file-backed path), where the store's actions stay purely local.
   */
  writes?: SessionWrites | undefined;
  children: ReactNode;
}

/**
 * Create the store per mount for SSR isolation, but switch briefs in place.
 * Re-derive during render: an effect would expose old ids to the new brief and crash.
 * The loader and writes keep the server authoritative.
 */
export function ReviewSessionProvider({
  briefId,
  model,
  session,
  writes,
  children,
}: ReviewSessionProviderProps) {
  // The gateway is rebuilt whenever the model behind its anchor mapping
  // changes; the store reads it through a ref so a revision switch never
  // recreates the store itself.
  const gateway = useMemo(
    () =>
      writes === undefined ? null : createSessionWriteGateway(model, writes),
    [model, writes],
  );
  const gatewayRef = useRef<SessionWriteGateway | null>(gateway);
  gatewayRef.current = gateway;
  const storeRef = useRef<ReviewSessionStore | null>(null);
  storeRef.current ??= createReviewSessionStore(
    sessionInitialState(model, session),
    () => gatewayRef.current,
  );
  const store = storeRef.current;
  const mountedBriefId = useRef(briefId);
  const appliedSession = useRef(session);

  // Reapply on session identity changes so a read recovering after first paint reaches
  // the store before writes resume. Structural sharing skips unchanged refetches.
  // The guarded render update runs once per change; server inputs cannot change mid-render.
  if (
    mountedBriefId.current !== briefId ||
    appliedSession.current !== session
  ) {
    // A different Brief is a different session: the frozen posture and any
    // pending failure copy belong to the one that was left behind. A refetch
    // of the SAME brief keeps them, the server session is still frozen, and
    // un-freezing would hand back controls whose every write fails.
    const switched = mountedBriefId.current !== briefId;
    mountedBriefId.current = briefId;
    appliedSession.current = session;
    const nextState: Partial<ReviewSessionStoreValue> = sessionInitialState(
      model,
      session,
    );

    if (switched) {
      nextState.frozen = false;
      nextState.writeError = null;
      nextState.deletedMissingDrafts = new Set<string>();
    }

    store.setState(nextState);
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
 * slice changes, not on every comment interaction elsewhere.
 */
export function useChunkReviewComments(chunkId: string): ReviewComment[] {
  return useReviewSession(
    useShallow((state) =>
      state.reviewComments.filter(
        (comment) =>
          isLineCommentAnchor(comment.anchor) &&
          comment.anchor.chunkId === chunkId,
      ),
    ),
  );
}

/**
 * Line comments of several chunks at once: a table showing sibling spans
 * reads the owners' comments beside its own. Same identity contract as the
 * single-chunk slice.
 */
export function useReviewCommentsForChunks(
  chunkIds: readonly string[],
): ReviewComment[] {
  return useReviewSession(
    useShallow((state) =>
      state.reviewComments.filter(
        (comment) =>
          isLineCommentAnchor(comment.anchor) &&
          chunkIds.includes(comment.anchor.chunkId),
      ),
    ),
  );
}

/**
 * File comments for one path. Split-file headers share this slice: the
 * Comment is one, shown under every header for that path.
 */
export function useFileReviewComments(filePath: string): ReviewComment[] {
  return useReviewSession(
    useShallow((state) =>
      state.reviewComments.filter(
        (comment) =>
          isFileCommentAnchor(comment.anchor) &&
          comment.anchor.file === filePath,
      ),
    ),
  );
}

/**
 * The server's unplaced drafts, less those this tab deleted from the
 * attention list since the last read: the set the submit route still holds.
 */
export function useUnplacedDrafts(): UnplacedDrafts {
  return useReviewSession(
    useShallow((state) =>
      state.unplacedDrafts.filter(
        (draft) => !state.deletedMissingDrafts.has(draft.id),
      ),
    ),
  );
}

export function useDraftCommentCount(): number {
  return useReviewSession((state) => countDraftComments(state.reviewComments));
}
