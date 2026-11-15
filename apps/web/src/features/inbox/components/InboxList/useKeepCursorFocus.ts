import { useEffect, useRef, type FocusEvent, type RefObject } from "react";

import { isFocusLost } from "@web/utils/main-content";
import { focusRowLink, NO_ROW, readRowIndex } from "./utils";

export interface KeepCursorFocusInput {
  listsRef: RefObject<HTMLElement | null>;
  cursorRowRef: RefObject<HTMLLIElement | null>;
  cursorRowKey: string | undefined;
  /** Both lists' row keys, so a row crossing the fold reads as a change. */
  rowsLayout: string;
  /** Moves the cursor to the row focus entered. */
  setCursorRow: (index: number) => void;
  focusHeading: (options?: FocusOptions) => void;
}

/** The handlers the lists and their rows wire so the keeper knows where focus is. */
export interface KeepCursorFocus {
  /** A row's React focus handler, which also hears focus in its portalled menu. */
  handleRowFocus: (rowKey: string) => void;
  handleListsFocus: (event: FocusEvent<HTMLElement>) => void;
  handleListsBlur: (event: FocusEvent<HTMLElement>) => void;
}

interface CursorRowSnapshot {
  readonly element: HTMLLIElement | null;
  readonly key: string | undefined;
}

const NO_CURSOR_ROW: CursorRowSnapshot = { element: null, key: undefined };
const FOCUS_IN_PLACE: FocusOptions = { preventScroll: true };

/**
 * A re-read that remounts the focused cursor row, or takes it away, drops
 * focus to the body. The same row's new element takes it back, without a
 * scroll; when the row left, the heading takes it, also without a scroll,
 * since a background poll must not move the page.
 * Focus that was anywhere else is never moved.
 */
export function useKeepCursorFocus({
  listsRef,
  cursorRowRef,
  cursorRowKey,
  rowsLayout,
  setCursorRow,
  focusHeading,
}: KeepCursorFocusInput): KeepCursorFocus {
  // The cursor follows focus, so focus inside a row is focus on the cursor row.
  // A focused element a re-read removes fires no blur, so the flag outlives it,
  // as it does a window blur, which leaves the link focused in the document.
  const focusInCursorRow = useRef(false);
  // A row's handler runs before the lists' for the same focus event.
  const focusedRowKey = useRef<string | undefined>(undefined);
  const lastCursorRow = useRef<CursorRowSnapshot>(NO_CURSOR_ROW);

  useEffect(() => {
    const previous = lastCursorRow.current;
    const element = cursorRowRef.current;
    lastCursorRow.current = { element, key: cursorRowKey };
    const replaced = previous.element !== null && !previous.element.isConnected;
    const dropped =
      focusInCursorRow.current && isFocusLost(document.activeElement);
    if (!replaced || !dropped) {
      return;
    }

    focusInCursorRow.current = false;
    const sameRow = previous.key !== undefined && previous.key === cursorRowKey;
    if (sameRow && element !== null) {
      focusRowLink(element);
      return;
    }
    focusHeading(FOCUS_IN_PLACE);
  }, [cursorRowKey, cursorRowRef, focusHeading, rowsLayout]);

  function handleRowFocus(rowKey: string): void {
    focusedRowKey.current = rowKey;
  }

  // React focus bubbles through a portal, so the row's report covers its
  // menu, which DOM containment misses. Only focus inside the row moves the
  // cursor: the menu opens from a trigger that already moved it there.
  function handleListsFocus(event: FocusEvent<HTMLElement>): void {
    const reportedKey = focusedRowKey.current;
    focusedRowKey.current = undefined;
    const index = readRowIndex(listsRef.current, event.target);
    const inCursorRow =
      reportedKey !== undefined && reportedKey === cursorRowKey;
    focusInCursorRow.current = index !== NO_ROW || inCursorRow;
    if (index !== NO_ROW) {
      setCursorRow(index);
    }
  }

  function handleListsBlur(event: FocusEvent<HTMLElement>): void {
    const pageKeepsFocus = document.hasFocus();
    if (event.target.isConnected && pageKeepsFocus) {
      focusInCursorRow.current = false;
    }
  }

  return { handleRowFocus, handleListsFocus, handleListsBlur };
}
