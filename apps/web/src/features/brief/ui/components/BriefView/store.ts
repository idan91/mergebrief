import { useRef } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ViewParam } from "../../../model/comparison/compare-state";
import type { BriefViewModel } from "../../../model/utils/view-model";
import { MarkReadyFlowKinds, type MarkReadyFlow } from "./types";
import {
  advanceMarkReadyFlowBatch,
  closeMarkReadyFlow,
  isCurrentMarkReadyBatch,
  listInitiallyOpenChunkIds,
  openMarkReadyFlow,
  startMarkReadyFlowBatch,
} from "./utils";

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
  markReadyFlow: MarkReadyFlow;
  postDraftsOnReady: boolean;
  /** Each risk attribute chip's next carrying-group position, before the wrap. */
  riskAttrCycle: ReadonlyMap<string, number>;
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
  openMarkReadyGate: () => void;
  closeMarkReadyGate: () => void;
  /** Starts the gate's batch; the token it returns, or undefined when none started. */
  startMarkReadyBatch: (total: number) => number | undefined;
  advanceMarkReadyBatch: (token: number, current: number) => void;
  setPostDraftsOnReady: (checked: boolean) => void;
  advanceRiskAttrCycle: (attr: string) => void;
  clearRiskAttrCycle: () => void;
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
  let batchToken = 0;
  return createStore<BriefViewStoreValue>((set, get) => ({
    shownScopes: new Set(),
    submitOpen: false,
    openChunks: new Set(seed.openChunkIds),
    focusMode: seed.focusMode,
    shortcutsOpen: false,
    chunkActionsFor: undefined,
    markReadyFlow: { kind: MarkReadyFlowKinds.CLOSED },
    postDraftsOnReady: false,
    riskAttrCycle: new Map(),
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
      openMarkReadyGate() {
        set((state) => ({
          markReadyFlow: openMarkReadyFlow(state.markReadyFlow),
        }));
      },
      closeMarkReadyGate() {
        set((state) => ({
          markReadyFlow: closeMarkReadyFlow(state.markReadyFlow),
        }));
      },
      startMarkReadyBatch(total) {
        batchToken += 1;
        const token = batchToken;
        const next = startMarkReadyFlowBatch(get().markReadyFlow, token, total);
        if (!isCurrentMarkReadyBatch(next, token)) {
          return undefined;
        }
        set({ markReadyFlow: next });
        return token;
      },
      advanceMarkReadyBatch(token, current) {
        set((state) => ({
          markReadyFlow: advanceMarkReadyFlowBatch(
            state.markReadyFlow,
            token,
            current,
          ),
        }));
      },
      setPostDraftsOnReady(checked) {
        set({ postDraftsOnReady: checked });
      },
      advanceRiskAttrCycle(attr) {
        set((state) => {
          const position = state.riskAttrCycle.get(attr) ?? 0;
          return {
            riskAttrCycle: new Map(state.riskAttrCycle).set(attr, position + 1),
          };
        });
      },
      clearRiskAttrCycle() {
        set((state) =>
          state.riskAttrCycle.size === 0 ? state : { riskAttrCycle: new Map() },
        );
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
