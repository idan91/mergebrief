import { useCallback, useEffect, useState } from "react";

import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import {
  readDiffView,
  resolveDiffView,
  writeDiffView,
} from "./diffViewStorage";

export interface UseDiffViewPreferenceInput {
  /** The `diff` URL param: a deep link, absent once the viewer chooses. */
  search: DiffView | undefined;
  /** Drops `diff` from the URL so the stored preference is what shows. */
  clearDiffParam?: (() => void) | undefined;
}

export interface DiffViewPreference {
  view: DiffView;
  setView: (view: DiffView) => void;
}

/**
 * Storage is read on the client only: SSR and the first paint both render
 * unified, so a remembered split view never arrives as a hydration mismatch.
 */
export function useDiffViewPreference({
  search,
  clearDiffParam,
}: UseDiffViewPreferenceInput): DiffViewPreference {
  const [stored, setStored] = useState<DiffView>(DiffViews.UNIFIED);
  const [lastSearch, setLastSearch] = useState<DiffView | undefined>(search);
  // A route that cannot drop the param would otherwise keep overriding the
  // viewer's own choice; dismissal holds until the link itself changes.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setStored(readDiffView());
  }, []);

  if (lastSearch !== search) {
    setLastSearch(search);
    setDismissed(false);
  }

  const view = resolveDiffView(dismissed ? undefined : search, stored);

  const setView = useCallback(
    (next: DiffView) => {
      setStored(next);
      writeDiffView(next);
      if (search === undefined) return;
      setDismissed(true);
      clearDiffParam?.();
    },
    [clearDiffParam, search],
  );

  return { view, setView };
}
