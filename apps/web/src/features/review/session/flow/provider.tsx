import { appI18n } from "../../../../i18n/I18nProvider";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";

import { useMindMapActions } from "../provider";
import {
  createReviewFlowStore,
  type ReviewFlowActions,
  type ReviewFlowPosture,
  type ReviewFlowStore,
  type ReviewFlowStoreValue,
} from "./store";

const ReviewFlowContext = createContext<ReviewFlowStore | null>(null);

/**
 * Creates the screen's ReviewFlow store (once per mount, never a module
 * singleton). Returned to the HOST component — the screen both provides the
 * store (via `ReviewFlowProvider`) and subscribes to it directly with
 * `useStore(store, selector)`, since it sits above its own provider. Creation
 * and posture sync are separate hooks because the full posture (post-now
 * wiring) is only derivable AFTER hooks that need this store's `announce`.
 */
export function useCreateReviewFlowStore(
  briefId: string,
  initialPosture: ReviewFlowPosture,
): ReviewFlowStore {
  const sessionActions = useMindMapActions();
  const storeRef = useRef<ReviewFlowStore | null>(null);
  storeRef.current ??= createReviewFlowStore(
    sessionActions,
    initialPosture,
    (key) => appI18n.t(key),
  );
  const store = storeRef.current;
  // Brief switch without remount: the ephemeral half (open composer, dismiss
  // and evidence targets, submit note, flag selection, toast) is anchored to
  // the OLD brief's ids and must not leak into the new one. Render-phase and
  // guarded, like the MindMapProvider switch; the posture half re-syncs via
  // useSyncReviewFlowPosture.
  const mountedBriefId = useRef(briefId);
  if (mountedBriefId.current !== briefId) {
    mountedBriefId.current = briefId;
    store.setState({
      composerAnchor: null,
      dismissTarget: null,
      evidenceTarget: null,
      expandedConversations: new Map(),
      reviewComment: "",
      selectedRiskFlags: new Set(),
      toast: "",
    });
  }
  return store;
}

/**
 * Keeps the store's posture slice in sync with the screen's derived values.
 * Effect-timed (per-field deps): render output reading posture lags the prop
 * by one commit, which only matters within a single frame — every consumer
 * path is interaction-driven, and the fields that affect first paint
 * (read-only reason, flags mirror) are already correct at creation.
 */
export function useSyncReviewFlowPosture(
  store: ReviewFlowStore,
  posture: ReviewFlowPosture,
): void {
  const {
    composerDisabledReason,
    flagsReadOnly,
    postingCommentIds,
    postBlockedExternally,
    postComment,
  } = posture;
  useEffect(() => {
    store.setState({
      composerDisabledReason,
      flagsReadOnly,
      postingCommentIds,
      postBlockedExternally,
      postComment,
    });
  }, [
    composerDisabledReason,
    flagsReadOnly,
    postBlockedExternally,
    postComment,
    postingCommentIds,
    store,
  ]);
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
