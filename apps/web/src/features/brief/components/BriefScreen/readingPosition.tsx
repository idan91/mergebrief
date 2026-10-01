import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Reading-position store (zustand-in-context, the ReviewFlow recipe): where
 * the reader IS, written by the scroll-spy and every explicit navigation,
 * subscribed to by the few components that show position (active card, TOC
 * bar, toolbar counter, focus panel, read-through progress). The screen shell
 * never subscribes, so a scroll-spy tick re-renders only those consumers.
 */
export interface ReadingPositionState {
  activeChunkId: string | null;
  /** Set together with the chunk by the writer (which holds the chunk→group
   * map); consumers never re-derive the group. */
  activeGroupId: string | null;
}

export interface ReadingPositionActions {
  setActive: (chunkId: string, groupId: string | null) => void;
}

export interface ReadingPositionStoreValue extends ReadingPositionState {
  actions: ReadingPositionActions;
}

export type ReadingPositionStore = StoreApi<ReadingPositionStoreValue>;

export function createReadingPositionStore(): ReadingPositionStore {
  return createStore<ReadingPositionStoreValue>((set) => ({
    activeChunkId: null,
    activeGroupId: null,
    actions: {
      setActive(chunkId, groupId) {
        set({ activeChunkId: chunkId, activeGroupId: groupId });
      },
    },
  }));
}

/**
 * Creates the screen's reading-position store (once per brief, never a module
 * singleton). A brief switch without remount gets a FRESH store, not a reset:
 * a render-phase `setState` would notify still-mounted subscribers while
 * their parent renders. The new store starts empty and reaches consumers
 * through context in the same render, so the old brief's ids never paint.
 */
export function useCreateReadingPositionStore(
  briefId: string,
): ReadingPositionStore {
  const storeRef = useRef<{
    briefId: string;
    store: ReadingPositionStore;
  } | null>(null);
  if (storeRef.current === null || storeRef.current.briefId !== briefId) {
    storeRef.current = { briefId, store: createReadingPositionStore() };
  }
  return storeRef.current.store;
}

const ReadingPositionContext = createContext<ReadingPositionStore | null>(null);

export interface ReadingPositionProviderProps {
  store: ReadingPositionStore;
  children: ReactNode;
}

export function ReadingPositionProvider({
  store,
  children,
}: ReadingPositionProviderProps) {
  return (
    <ReadingPositionContext.Provider value={store}>
      {children}
    </ReadingPositionContext.Provider>
  );
}

export function useReadingPosition<T>(
  selector: (state: ReadingPositionStoreValue) => T,
): T {
  const store = useContext(ReadingPositionContext);
  if (!store) throw new Error("ReadingPositionProvider is missing");
  return useStore(store, selector);
}
