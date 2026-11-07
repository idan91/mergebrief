import { useCallback, useRef, useState } from "react";

import type { InboxItem } from "../../types";
import { readRowKey } from "../../utils";

export interface InboxSelection {
  /** The ticked rows still on the page, in the page's order. */
  readonly selectedItems: readonly InboxItem[];
  readonly allSelected: boolean;
  /** Some rows ticked, not every one: the page checkbox reads mixed. */
  readonly someSelected: boolean;
  readonly isSelected: (item: InboxItem) => boolean;
  /** With `range`, every row between the last ticked row and this one takes `checked`. */
  readonly setSelected: (
    item: InboxItem,
    checked: boolean,
    range?: boolean,
  ) => void;
  /** Tick every row on the page, or clear them all. */
  readonly selectPage: (checked: boolean) => void;
  /** Untick the rows that went; every other tick stays. */
  readonly remove: (gone: readonly InboxItem[]) => void;
  readonly clear: () => void;
}

const NONE: ReadonlySet<string> = new Set();

/** The row keys from the anchor to the target, inclusive; none when either left the page. */
function readSpan(
  items: readonly InboxItem[],
  anchor: string | undefined,
  target: string,
): readonly string[] | undefined {
  if (anchor === undefined) {
    return undefined;
  }
  const keys = items.map(readRowKey);
  const from = keys.indexOf(anchor);
  const to = keys.indexOf(target);
  if (from < 0 || to < 0) {
    return undefined;
  }
  return keys.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/**
 * Which rows are ticked, keyed by row identity so a re-read keeps them;
 * a row that left the page leaves the selection with it. A bulk action
 * removes the rows that went and nothing else, so a tick or a clear made
 * while it ran survives it.
 */
export function useInboxSelection(items: readonly InboxItem[]): InboxSelection {
  const [keys, setKeys] = useState<ReadonlySet<string>>(NONE);
  const anchorRef = useRef<string | undefined>(undefined);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedItems = items.filter((item) => keys.has(readRowKey(item)));
  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const someSelected = selectedItems.length > 0 && !allSelected;

  // Stable: the list clears the selection from an effect keyed on the page.
  const clear = useCallback((): void => {
    anchorRef.current = undefined;
    setKeys(NONE);
  }, []);
  const setSelected = useCallback(
    (item: InboxItem, checked: boolean, range = false): void => {
      const key = readRowKey(item);
      const anchor = anchorRef.current;
      anchorRef.current = key;
      setKeys((current) => {
        const next = new Set(current);
        const span = readSpan(itemsRef.current, anchor, key);
        const rowKeys = range && span !== undefined ? span : [key];
        for (const rowKey of rowKeys) {
          if (checked) {
            next.add(rowKey);
          } else {
            next.delete(rowKey);
          }
        }
        return next;
      });
    },
    [],
  );
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
    setSelected,
    selectPage: (checked) => {
      anchorRef.current = undefined;
      setKeys(checked ? new Set(items.map(readRowKey)) : NONE);
    },
    remove,
    clear,
  };
}
