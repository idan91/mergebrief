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
 * Creates the screen's ReviewFlow store, once per Brief and never a module
 * singleton. A switch without remount gets a FRESH store rather than a
 * render-phase reset: the old store's state is anchored to the old Brief's
 * ids, and its comment actions delegate to the old Brief's session store.
 * Returned to the HOST component, which both provides the store and
 * subscribes to it directly, since it sits above its own provider.
 */
export function useCreateReviewFlowStore(briefId: string): ReviewFlowStore {
  const sessionActions = useReviewSessionActions();
  const storeRef = useRef<{ briefId: string; store: ReviewFlowStore } | null>(
    null,
  );
  if (storeRef.current === null || storeRef.current.briefId !== briefId) {
    storeRef.current = {
      briefId,
      store: createReviewFlowStore(
        sessionActions,
        (key) => appI18n.t(key),
        briefId,
      ),
    };
  }
  return storeRef.current.store;
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
  if (!store) {
    throw new Error("ReviewFlowProvider is missing");
  }
  return useStore(store, selector);
}

export function useReviewActions(): ReviewFlowActions {
  return useReviewFlow((state) => state.actions);
}
