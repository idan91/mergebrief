import type { LineRange } from "brief-core/types";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { EdgeExpansion } from "../types";
import { unionExpanded } from "../utils/expandRows";

export interface ExpansionState {
  /**
   * Head-file lines each hunk edge has expanded, keyed
   * `chunkId:rowIndex:direction`. Ranges, not rows: the splice is pure and
   * memoized per chunk, so one range per edge keeps a re-render cheap
   * without duplicating the diff in the store.
   */
  expandedEdges: ReadonlyMap<string, EdgeExpansion>;
  /** Line counts the file-range reads have reported, by path. */
  fileEnds: ReadonlyMap<string, number>;
}

export interface ExpansionActions {
  /**
   * Widen one hunk edge's expanded window by the lines a click just read.
   * Ranges union, so a repeat of the same read changes nothing.
   */
  expandEdge: (
    edgeKey: string,
    range: LineRange,
    totalLines?: number,
    path?: string,
  ) => void;
}

export interface ExpansionStoreValue extends ExpansionState {
  actions: ExpansionActions;
}

export type ExpansionStore = StoreApi<ExpansionStoreValue>;

/** What one hunk edge has expanded so far; absent until its first click. */
export function readExpansion(
  state: ExpansionState,
  edgeKey: string,
): EdgeExpansion | undefined {
  return state.expandedEdges.get(edgeKey);
}

function widenEdge(
  current: EdgeExpansion | undefined,
  range: LineRange,
  totalLines: number | undefined,
): EdgeExpansion {
  const ranges = current?.ranges ?? [];
  const seen = ranges.some(
    (read) => read.start === range.start && read.end === range.end,
  );
  const widened: EdgeExpansion = {
    range: unionExpanded(current?.range, range),
    ranges: seen ? ranges : [...ranges, range],
  };
  const fileEnd = totalLines ?? current?.totalLines;
  if (fileEnd !== undefined) {
    widened.totalLines = fileEnd;
  }
  return widened;
}

export function createExpansionStore(): ExpansionStore {
  return createStore<ExpansionStoreValue>((set) => ({
    expandedEdges: new Map(),
    fileEnds: new Map(),
    actions: {
      expandEdge(edgeKey, range, totalLines, path) {
        set((state) => {
          let fileEnds = state.fileEnds;
          if (totalLines !== undefined && path !== undefined) {
            fileEnds = new Map(state.fileEnds).set(path, totalLines);
          }
          const current = state.expandedEdges.get(edgeKey);
          const expandedEdges = new Map(state.expandedEdges).set(
            edgeKey,
            widenEdge(current, range, totalLines),
          );
          return { expandedEdges, fileEnds };
        });
      },
    },
  }));
}

/**
 * One expansion store per Brief: a switch without remount gets a fresh store,
 * not a render-phase reset, and a session refetch keeps the same one.
 */
export function useCreateExpansionStore(briefId: string): ExpansionStore {
  const storeRef = useRef<{ briefId: string; store: ExpansionStore } | null>(
    null,
  );
  if (storeRef.current === null || storeRef.current.briefId !== briefId) {
    storeRef.current = { briefId, store: createExpansionStore() };
  }
  return storeRef.current.store;
}

const ExpansionContext = createContext<ExpansionStore | null>(null);

export interface ExpansionProviderProps {
  store: ExpansionStore;
  children: ReactNode;
}

export function ExpansionProvider({ store, children }: ExpansionProviderProps) {
  return (
    <ExpansionContext.Provider value={store}>
      {children}
    </ExpansionContext.Provider>
  );
}

export function useExpansion<Selected>(
  selector: (state: ExpansionStoreValue) => Selected,
): Selected {
  const store = useContext(ExpansionContext);
  if (store === null) {
    throw new Error("ExpansionProvider is missing");
  }
  return useStore(store, selector);
}

export function useExpansionActions(): ExpansionActions {
  return useExpansion((state) => state.actions);
}
