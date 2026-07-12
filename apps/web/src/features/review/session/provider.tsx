import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { BriefViewModel } from "../../brief/viewModel";
import type { ReviewComment } from "../comments";
import {
  createMindMapStore,
  deriveInitialState,
  type MindMapActions,
  type MindMapStore,
  type MindMapStoreValue,
} from "./store";
import {
  readSnapshot,
  serializeSnapshot,
  snapshotToState,
  writeSnapshot,
  type SessionSnapshot,
} from "./snapshot";

const MindMapContext = createContext<MindMapStore | null>(null);
const PERSIST_DEBOUNCE_MS = 250;

interface MindMapProviderProps {
  briefId: string;
  model: BriefViewModel;
  /**
   * @description Explicit snapshot injection for tests and summary routes.
   * Otherwise, the provider reads from storage.
   */
  snapshot?: SessionSnapshot;
  children: ReactNode;
}

/**
 * Per-brief client runtime of the Mind-Map Space. The store is created once per
 * mount (never a module singleton), so it is SSR-safe and per-brief isolated,
 * mirroring the per-request queryClient. Hydration and persistence are the only
 * two effects that touch sessionStorage — client-only by construction.
 */
export function MindMapProvider({
  briefId,
  model,
  snapshot,
  children,
}: MindMapProviderProps) {
  const storeRef = useRef<MindMapStore | null>(null);
  storeRef.current ??= createMindMapStore(deriveInitialState(model));
  const store = storeRef.current;

  // Hydrate post-mount (server render has no storage; matches prior behaviour).
  useEffect(() => {
    const persisted = snapshot ?? readSnapshot(briefId);
    if (persisted) store.setState(snapshotToState(persisted));
  }, [briefId, snapshot, store]);

  // One debounced effect persists the store to sessionStorage on every change.
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = store.subscribe((state) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => writeSnapshot(serializeSnapshot(briefId, state)),
        PERSIST_DEBOUNCE_MS,
      );
    });
    return () => {
      // Flush a pending debounced write so a last edit just before unmount
      // (e.g. switching briefs, which remounts the provider) isn't dropped.
      if (timer !== undefined) {
        window.clearTimeout(timer);
        writeSnapshot(serializeSnapshot(briefId, store.getState()));
      }
      unsubscribe();
    };
  }, [briefId, store]);

  return (
    <MindMapContext.Provider value={store}>{children}</MindMapContext.Provider>
  );
}

export function useMindMap<T>(selector: (state: MindMapStoreValue) => T): T {
  const store = useContext(MindMapContext);
  if (!store) throw new Error("MindMapProvider is missing");
  return useStore(store, selector);
}

export function useMindMapActions(): MindMapActions {
  return useMindMap((state) => state.actions);
}

/**
 * The chunk-scoped slice of the session's review comments. `useShallow`
 * keeps the returned array identity stable while the chunk's own comments
 * are reference-unchanged, so a memoized consumer re-renders only when its
 * slice changes — not on every comment interaction elsewhere (BRIEF-27).
 */
export function useChunkReviewComments(chunkId: string): ReviewComment[] {
  return useMindMap(
    useShallow((state) =>
      state.reviewComments.filter(
        (comment) => comment.anchor.chunkId === chunkId,
      ),
    ),
  );
}
