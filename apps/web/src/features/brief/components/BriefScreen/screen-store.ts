import { useRef } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ViewParam } from "../../comparison/compareState";
import type { BriefViewModel } from "../../utils/viewModel";
import type { MarkReadyBatch } from "./types";
import { listChunkIds } from "./utils";

/** The screen state one Brief owns; the next Brief starts from a fresh copy. */
export interface BriefScreenState {
  /** Scopes whose pane has rendered; a shown pane stays mounted while hidden. */
  shownScopes: ReadonlySet<ViewParam>;
  submitOpen: boolean;
  openChunks: ReadonlySet<string>;
  focusMode: boolean;
  shortcutsOpen: boolean;
  markReadyGateOpen: boolean;
  postDraftsOnReady: boolean;
  markReadyBatch: MarkReadyBatch | undefined;
}

export interface BriefScreenActions {
  markScopeShown: (scope: ViewParam) => void;
  setSubmitOpen: (open: boolean) => void;
  updateOpenChunks: (
    update: (current: ReadonlySet<string>) => ReadonlySet<string>,
  ) => void;
  setFocusMode: (on: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setMarkReadyGateOpen: (open: boolean) => void;
  setPostDraftsOnReady: (checked: boolean) => void;
  setMarkReadyBatch: (batch: MarkReadyBatch | undefined) => void;
}

export interface BriefScreenStoreValue extends BriefScreenState {
  actions: BriefScreenActions;
}

export type BriefScreenStore = StoreApi<BriefScreenStoreValue>;

export interface BriefScreenSeed {
  openChunkIds: readonly string[];
  focusMode: boolean;
}

export function createBriefScreenStore(
  seed: BriefScreenSeed,
): BriefScreenStore {
  return createStore<BriefScreenStoreValue>((set) => ({
    shownScopes: new Set(),
    submitOpen: false,
    openChunks: new Set(seed.openChunkIds),
    focusMode: seed.focusMode,
    shortcutsOpen: false,
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

export interface BriefScreenStoreInput {
  model: BriefViewModel;
  /** Applies to the Brief the screen mounts with; a switch starts outside Focus mode. */
  initialFocusMode: boolean;
}

/**
 * One store per Brief, swapped by ref like the reading-position store: a
 * switch without remount gets a fresh store, never a render-phase reset of
 * the old one, so the old Brief's open overlays never paint on the new one.
 */
export function useCreateBriefScreenStore(
  briefId: string,
  input: BriefScreenStoreInput,
): BriefScreenStore {
  const storeRef = useRef<{ briefId: string; store: BriefScreenStore } | null>(
    null,
  );
  if (storeRef.current === null || storeRef.current.briefId !== briefId) {
    const mounting = storeRef.current === null;
    const store = createBriefScreenStore({
      openChunkIds: listChunkIds(input.model.groups),
      focusMode: mounting && input.initialFocusMode,
    });
    storeRef.current = { briefId, store };
  }
  return storeRef.current.store;
}
