import { useCallback, useEffect, useState } from "react";

import type { DiffView } from "@web/components/DiffRows/types";
import {
  migrateLegacyDiffView,
  readDiffView,
  resolveDiffView,
  writeDiffView,
} from "./diff-view-storage";

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
 * The stored view seeds the first render on both sides from the cookie, so
 * the server draws the view the reader picked and hydration agrees with it.
 */
export function useDiffViewPreference({
  search,
  clearDiffParam,
}: UseDiffViewPreferenceInput): DiffViewPreference {
  const [stored, setStored] = useState<DiffView>(readDiffView);
  const [lastSearch, setLastSearch] = useState<DiffView | undefined>(search);
  // A route that cannot drop the param would otherwise keep overriding the
  // viewer's own choice; dismissal holds until the link itself changes.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const migrated = migrateLegacyDiffView();
    if (migrated !== undefined) {
      setStored(migrated);
    }
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
      if (search === undefined) {
        return;
      }
      setDismissed(true);
      clearDiffParam?.();
    },
    [clearDiffParam, search],
  );

  return { view, setView };
}
