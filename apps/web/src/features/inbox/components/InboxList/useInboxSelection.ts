import { useCallback, useState } from "react";

import type { InboxItem } from "../../types";
import { readRowKey } from "../../utils";

export interface InboxSelection {
  /** The ticked rows still on the page, in the page's order. */
  readonly selectedItems: readonly InboxItem[];
  readonly allSelected: boolean;
  /** Some rows ticked, not every one: the page checkbox reads mixed. */
  readonly someSelected: boolean;
  readonly isSelected: (item: InboxItem) => boolean;
  readonly toggle: (item: InboxItem) => void;
  /** Tick every row on the page, or clear them all when every one is ticked. */
  readonly selectPage: () => void;
  /** Untick the rows that went; every other tick stays. */
  readonly remove: (gone: readonly InboxItem[]) => void;
  readonly clear: () => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Which rows are ticked, keyed by row identity so a re-read keeps them;
 * a row that left the page leaves the selection with it. A bulk action
 * removes the rows that went and nothing else, so a tick or a clear made
 * while it ran survives it.
 */
export function useInboxSelection(items: readonly InboxItem[]): InboxSelection {
  const [keys, setKeys] = useState<ReadonlySet<string>>(NONE);
  const selectedItems = items.filter((item) => keys.has(readRowKey(item)));
  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const someSelected = selectedItems.length > 0 && !allSelected;

  // Stable: the list clears the selection from an effect keyed on the page.
  const clear = useCallback((): void => {
    setKeys(NONE);
  }, []);
  const toggle = useCallback((item: InboxItem): void => {
    const key = readRowKey(item);
    setKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const remove = useCallback((gone: readonly InboxItem[]): void => {
    const goneKeys = new Set(gone.map(readRowKey));
    setKeys((current) => {
      const next = new Set(current);
      for (const key of goneKeys) {
        next.delete(key);
      }
      return next;
    });
  }, []);

  return {
    selectedItems,
    allSelected,
    someSelected,
    isSelected: (item) => keys.has(readRowKey(item)),
    toggle,
    selectPage: () => {
      setKeys(allSelected ? NONE : new Set(items.map(readRowKey)));
    },
    remove,
    clear,
  };
}
