import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { BriefViewModel } from "@web/features/brief/utils";
import type { ReviewComment } from "../utils/comments";
import {
  createReviewSessionStore,
  deriveInitialState,
  type ReviewSessionActions,
  type ReviewSessionStore,
  type ReviewSessionStoreValue,
} from "./store";
import {
  readSnapshot,
  serializeSnapshot,
  snapshotToState,
  writeSnapshot,
  type SessionSnapshot,
} from "./snapshot";

const ReviewSessionContext = createContext<ReviewSessionStore | null>(null);
const PERSIST_DEBOUNCE_MS = 250;

interface ReviewSessionProviderProps {
  briefId: string;
  model: BriefViewModel;
  /**
   * @description Explicit snapshot injection for tests and summary routes.
   * Otherwise, the provider reads from storage.
   */
  snapshot?: SessionSnapshot;
  children: ReactNode;
}

/** The pending debounced persist write, reachable from the render-phase switch. */
interface PendingPersist {
  timer: number | undefined;
}

/**
 * Per-brief client runtime of the Review Session. The store is created once per
 * mount (never a module singleton), so it is SSR-safe and per-brief isolated,
 * mirroring the per-request queryClient. Hydration and persistence are the only
 * two effects that touch sessionStorage — client-only by construction.
 *
 * The provider is NOT remounted per brief: a revision change swaps `briefId`
 * in place, and the render-phase switch below re-derives the store — flush the
 * old brief's pending write, reset to the new model's derived state, hydrate
 * the new brief's snapshot — before any child renders against the new model.
 * An effect would be too late: one frame of the old brief's ids against the
 * new model's flags/groups is a crash, not a flicker.
 */
export function ReviewSessionProvider({
  briefId,
  model,
  snapshot,
  children,
}: ReviewSessionProviderProps) {
  const storeRef = useRef<ReviewSessionStore | null>(null);
  storeRef.current ??= createReviewSessionStore(deriveInitialState(model));
  const store = storeRef.current;
  const pendingPersist = useRef<PendingPersist>({ timer: undefined });
  const mountedBriefId = useRef(briefId);

  // Render-phase brief switch (guarded, so it runs once per change and never
  // on the server, where briefId cannot change within the single render pass).
  if (mountedBriefId.current !== briefId) {
    const previousBriefId = mountedBriefId.current;
    mountedBriefId.current = briefId;
    // The old brief's last edit may still sit in the debounce window — flush
    // it under the OLD id before the state below stops being that brief's.
    if (pendingPersist.current.timer !== undefined) {
      window.clearTimeout(pendingPersist.current.timer);
      pendingPersist.current.timer = undefined;
      writeSnapshot(serializeSnapshot(previousBriefId, store.getState()));
    }
    const persisted = snapshot ?? readSnapshot(briefId);
    store.setState({
      ...deriveInitialState(model),
      ...(persisted ? snapshotToState(persisted) : {}),
    });
  }

  // Hydrate post-mount: the server render has no storage. Also re-runs on a
  // brief switch, where it re-applies what the render-phase switch already
  // set — harmless, and it keeps first-mount hydration in one place.
  useEffect(() => {
    const persisted = snapshot ?? readSnapshot(briefId);
    if (persisted) store.setState(snapshotToState(persisted));
  }, [briefId, snapshot, store]);

  // One debounced effect persists the store to sessionStorage on every change.
  // The timer handle lives in a ref so the render-phase switch above can flush
  // a write the unmount cleanup would otherwise own.
  useEffect(() => {
    const pending = pendingPersist.current;
    // Every write is gated on this closure's briefId still being current:
    // the render-phase switch resets the store BEFORE this subscription is
    // torn down, so an unguarded subscriber (or its cleanup flush) would
    // persist the NEW brief's state under the OLD brief's key.
    const current = () => mountedBriefId.current === briefId;
    const unsubscribe = store.subscribe((state) => {
      if (!current()) return;
      window.clearTimeout(pending.timer);
      pending.timer = window.setTimeout(() => {
        pending.timer = undefined;
        if (current()) writeSnapshot(serializeSnapshot(briefId, state));
      }, PERSIST_DEBOUNCE_MS);
    });
    return () => {
      // Flush a pending debounced write so a last edit just before unmount
      // (leaving the brief page entirely) isn't dropped.
      if (pending.timer !== undefined) {
        window.clearTimeout(pending.timer);
        pending.timer = undefined;
        if (current()) {
          writeSnapshot(serializeSnapshot(briefId, store.getState()));
        }
      }
      unsubscribe();
    };
  }, [briefId, store]);

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
