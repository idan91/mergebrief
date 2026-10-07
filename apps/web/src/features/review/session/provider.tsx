import {
  createContext,
  useContext,
  useEffect,
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

/** The store's side of one Brief's session reads. */
export interface SessionReadListener {
  startRead(): void;
  landRead(payload: ReviewSessionPayload): void;
  hasPendingWrite(): boolean;
}

/**
 * The read lifecycle of one Brief's session query. `startRead` must fire
 * synchronously when a fetch begins, before any write can start after it.
 */
export interface SessionReadSource {
  subscribe(listener: SessionReadListener): () => void;
  /** Rereads this Brief's session; never one no screen observes. */
  requestRead(): void;
}

interface ReviewSessionProviderProps {
  briefId: string;
  model: BriefViewModel;
  /**
   * The server-held session the store starts from. Absent = no session to
   * show (a file-backed Brief, or a read that failed), and the screen is
   * read-only.
   */
  session?: ReviewSessionPayload | undefined;
  /** Every later read; absent on the file-backed path, which never rereads. */
  reads?: SessionReadSource | undefined;
  /**
   * The session write transport. Absent = no writes wired (the local
   * file-backed path), where the store's actions stay purely local.
   */
  writes?: SessionWrites | undefined;
  children: ReactNode;
}

interface SessionStoreEntry {
  briefId: string;
  store: ReviewSessionStore;
  landRead: (model: BriefViewModel, payload: ReviewSessionPayload) => void;
}

/**
 * Pairs a fresh store with the payload it last took, so a refetch that
 * structural sharing hands back unchanged never replaces the store.
 */
function createSessionStoreEntry(
  briefId: string,
  model: BriefViewModel,
  session: ReviewSessionPayload | undefined,
  getGateway: () => SessionWriteGateway | null,
): SessionStoreEntry {
  const store = createReviewSessionStore(
    sessionInitialState(model, session),
    getGateway,
  );
  let appliedRead = session;
  return {
    briefId,
    store,
    landRead(readModel, payload) {
      if (payload === appliedRead) {
        return;
      }
      const applied = store.applyRead(() =>
        sessionInitialState(readModel, payload),
      );
      if (applied) {
        appliedRead = payload;
      }
    },
  };
}

/**
 * One store per Brief: a switch gets a fresh one rather than a reset, so the
 * old Brief's ids, frozen posture and failure copy never reach the new one.
 */
function useCreateSessionStoreEntry(
  briefId: string,
  model: BriefViewModel,
  session: ReviewSessionPayload | undefined,
  getGateway: () => SessionWriteGateway | null,
): SessionStoreEntry {
  const entryRef = useRef<SessionStoreEntry | null>(null);
  if (entryRef.current === null || entryRef.current.briefId !== briefId) {
    entryRef.current = createSessionStoreEntry(
      briefId,
      model,
      session,
      getGateway,
    );
  }
  return entryRef.current;
}

/**
 * Forwards the store's read requests to the source a tick later: a request
 * can come from inside the query cache's own notification, which must not
 * refetch re-entrantly. Unsubscribing also cancels a request not yet sent.
 */
function forwardReadRequests(
  store: ReviewSessionStore,
  reads: SessionReadSource,
): () => void {
  let subscribed = true;
  const unsubscribe = store.subscribeReadRequests(() => {
    queueMicrotask(() => {
      if (subscribed) {
        reads.requestRead();
      }
    });
  });
  return () => {
    subscribed = false;
    unsubscribe();
  };
}

function useSessionReads(
  entry: SessionStoreEntry,
  model: BriefViewModel,
  reads: SessionReadSource | undefined,
): void {
  useEffect(() => {
    if (reads === undefined) {
      return undefined;
    }
    const { store } = entry;
    const stopForwarding = forwardReadRequests(store, reads);
    const unsubscribe = reads.subscribe({
      startRead: () => store.startRead(),
      landRead: (payload) => entry.landRead(model, payload),
      hasPendingWrite: () => store.hasPendingWrite(),
    });
    return () => {
      stopForwarding();
      unsubscribe();
    };
  }, [entry, model, reads]);
}

export function ReviewSessionProvider({
  briefId,
  model,
  session,
  reads,
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
  const entry = useCreateSessionStoreEntry(
    briefId,
    model,
    session,
    () => gatewayRef.current,
  );
  useSessionReads(entry, model, reads);

  return (
    <ReviewSessionContext.Provider value={entry.store}>
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
