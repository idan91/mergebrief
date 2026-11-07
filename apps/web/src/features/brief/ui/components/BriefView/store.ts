import { useRef } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ViewParam } from "../../../model/comparison/compare-state";
import type { BriefViewModel } from "../../../model/utils/view-model";
import type { MarkReadyBatch } from "./types";
import { listInitiallyOpenChunkIds } from "./utils";

/** The screen state one Brief owns; the next Brief starts from a fresh copy. */
export interface BriefViewState {
  /** Scopes whose pane has rendered; a shown pane stays mounted while hidden. */
  shownScopes: ReadonlySet<ViewParam>;
  submitOpen: boolean;
  openChunks: ReadonlySet<string>;
  focusMode: boolean;
  shortcutsOpen: boolean;
  /** The chunk whose actions sheet is open; the sheet is modal, so one at most. */
  chunkActionsFor: string | undefined;
  markReadyGateOpen: boolean;
  postDraftsOnReady: boolean;
  markReadyBatch: MarkReadyBatch | undefined;
}

export interface BriefViewActions {
  markScopeShown: (scope: ViewParam) => void;
  setSubmitOpen: (open: boolean) => void;
  updateOpenChunks: (
    update: (current: ReadonlySet<string>) => ReadonlySet<string>,
  ) => void;
  setFocusMode: (on: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setChunkActionsFor: (chunkId: string | undefined) => void;
  setMarkReadyGateOpen: (open: boolean) => void;
  setPostDraftsOnReady: (checked: boolean) => void;
  setMarkReadyBatch: (batch: MarkReadyBatch | undefined) => void;
}

export interface BriefViewStoreValue extends BriefViewState {
  actions: BriefViewActions;
}

export type BriefViewStore = StoreApi<BriefViewStoreValue>;

export interface BriefViewSeed {
  openChunkIds: readonly string[];
  focusMode: boolean;
}

export function createBriefViewStore(seed: BriefViewSeed): BriefViewStore {
  return createStore<BriefViewStoreValue>((set) => ({
    shownScopes: new Set(),
    submitOpen: false,
    openChunks: new Set(seed.openChunkIds),
    focusMode: seed.focusMode,
    shortcutsOpen: false,
    chunkActionsFor: undefined,
    markReadyGateOpen: false,
    postDraftsOnReady: false,
    markReadyBatch: undefined,
    actions: {
      markScopeShown(scope) {
        set((state) =>
          state.shownScopes.has(scope)
            ? state
            : { shownScopes: new Set(state.shownScopes).add(scope) },
        );
      },
      setSubmitOpen(open) {
        set({ submitOpen: open });
      },
      updateOpenChunks(update) {
        set((state) => ({ openChunks: update(state.openChunks) }));
      },
      setFocusMode(on) {
        set({ focusMode: on });
      },
      setShortcutsOpen(open) {
        set({ shortcutsOpen: open });
      },
      setChunkActionsFor(chunkId) {
        set({ chunkActionsFor: chunkId });
      },
      setMarkReadyGateOpen(open) {
        set({ markReadyGateOpen: open });
      },
      setPostDraftsOnReady(checked) {
        set({ postDraftsOnReady: checked });
      },
      setMarkReadyBatch(batch) {
        set({ markReadyBatch: batch });
      },
    },
  }));
}

export interface BriefViewStoreInput {
  model: BriefViewModel;
  /** Applies to the Brief the screen mounts with; a switch starts outside Focus mode. */
  initialFocusMode: boolean;
}

/**
 * One store per Brief, swapped by ref like the reading-position store: a
 * switch without remount gets a fresh store, never a render-phase reset of
 * the old one, so the old Brief's open overlays never paint on the new one.
 */
export function useCreateBriefViewStore(
  briefId: string,
  input: BriefViewStoreInput,
): BriefViewStore {
  const storeRef = useRef<
    { briefId: string; store: BriefViewStore } | undefined
  >(undefined);
  const current = storeRef.current;
  const reusable = current !== undefined && current.briefId === briefId;
  if (reusable) {
    return current.store;
  }

  const mounting = current === undefined;
  const focusMode = mounting && input.initialFocusMode;
  const store = createBriefViewStore({
    openChunkIds: listInitiallyOpenChunkIds(input.model.groups),
    focusMode,
  });
  storeRef.current = { briefId, store };
  return store;
}
