import { appI18n } from "../../../../i18n/I18nProvider";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";

import { useReviewSessionActions } from "../provider";
import {
  createReviewFlowStore,
  type ReviewFlowActions,
  type ReviewFlowStore,
  type ReviewFlowStoreValue,
} from "./store";

const ReviewFlowContext = createContext<ReviewFlowStore | null>(null);

/**
 * Creates the screen's ReviewFlow store (once per mount, never a module
 * singleton). Returned to the HOST component: the screen both provides the
 * store (via `ReviewFlowProvider`) and subscribes to it directly with
 * `useStore(store, selector)`, since it sits above its own provider.
 */
export function useCreateReviewFlowStore(briefId: string): ReviewFlowStore {
  const sessionActions = useReviewSessionActions();
  const storeRef = useRef<ReviewFlowStore | null>(null);
  storeRef.current ??= createReviewFlowStore(sessionActions, (key) =>
    appI18n.t(key),
  );
  const store = storeRef.current;
  // Brief switch without remount: the ephemeral half (open composer, dismiss
  // and evidence targets, submit note, flag selection, toast) is anchored to
  // the OLD brief's ids and must not leak into the new one. Render-phase and
  // guarded.
  const mountedBriefId = useRef(briefId);
  if (mountedBriefId.current !== briefId) {
    mountedBriefId.current = briefId;
    store.setState({
      composerAnchor: null,
      composerHost: null,
      dismissTarget: null,
      evidenceTarget: null,
      lineSelection: null,
      expandedConversations: new Map(),
      expandedEdges: new Map(),
      fileEnds: new Map(),
      reviewComment: "",
      selectedRiskFlags: new Set(),
      toast: "",
      liveMessage: "",
    });
  }
  return store;
}

export interface ReviewFlowProviderProps {
  store: ReviewFlowStore;
  children: ReactNode;
}

export function ReviewFlowProvider({
  store,
  children,
}: ReviewFlowProviderProps) {
  return (
    <ReviewFlowContext.Provider value={store}>
      {children}
    </ReviewFlowContext.Provider>
  );
}

export function useReviewFlow<T>(
  selector: (state: ReviewFlowStoreValue) => T,
): T {
  const store = useContext(ReviewFlowContext);
  if (!store) throw new Error("ReviewFlowProvider is missing");
  return useStore(store, selector);
}

export function useReviewActions(): ReviewFlowActions {
  return useReviewFlow((state) => state.actions);
}
