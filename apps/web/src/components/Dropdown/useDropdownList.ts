import {
  useListNavigation,
  useRole,
  useTypeahead,
  type ElementProps,
  type FloatingContext,
} from "@floating-ui/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { DropdownRoles, type DropdownRole } from "./types";

export interface DropdownListOptions {
  role: DropdownRole;
}

/** The list machinery a root adds on top of `usePopover`. */
export interface DropdownListState {
  readonly activeIndex: number | null;
  readonly elementsRef: MutableRefObject<(HTMLElement | null)[]>;
  readonly labelsRef: MutableRefObject<(string | null)[]>;
  readonly markSelected: (index: number, selected: boolean) => void;
  /** Role, arrow navigation and typeahead, in that order. */
  readonly interactions: ElementProps[];
}

/**
 * floating-ui re-roles a listbox's reference as a combobox; the trigger here
 * is a button that announces what it opens through `aria-haspopup`.
 */
function keepReferenceAButton(role: ElementProps): ElementProps {
  const { role: _role, ...reference } = role.reference ?? {};
  return { ...role, reference };
}

function isEnabledRow(row: HTMLElement | null): row is HTMLElement {
  return row !== null && row.getAttribute("aria-disabled") !== "true";
}

/**
 * Scroll the panel, never the page: on a first open the panel is still at
 * the document's corner until floating-ui places it, and scrollIntoView
 * would drag the window there.
 */
function revealRowInPanel(row: HTMLElement): void {
  const panel = row.closest('[role="listbox"], [role="menu"]');
  if (!(panel instanceof HTMLElement)) {
    return;
  }
  const rowRect = row.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const top = rowRect.top - panelRect.top + panel.scrollTop;
  const bottom = top + rowRect.height;
  if (top < panel.scrollTop) {
    panel.scrollTop = top;
  } else if (bottom > panel.scrollTop + panel.clientHeight) {
    panel.scrollTop = bottom - panel.clientHeight;
  }
}

/** The row the list opens on: a listbox's first ticked row, else the first enabled row. */
function pickOpenIndex(
  role: DropdownRole,
  rows: readonly (HTMLElement | null)[],
  ticked: ReadonlySet<number>,
): number {
  if (role === DropdownRoles.LISTBOX && ticked.size > 0) {
    return Math.min(...ticked);
  }
  const first = rows.findIndex(isEnabledRow);
  return first === -1 ? 0 : first;
}

/**
 * Arrow keys with wrap, Home and End, typeahead over the row labels, and the
 * ARIA role pair. A listbox opens on its first ticked row, a menu on its
 * first row; a disabled first row is skipped.
 */
export function useDropdownList(
  context: FloatingContext,
  { role }: DropdownListOptions,
): DropdownListState {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const tickedRef = useRef(new Set<number>());
  const elementsRef = useRef<(HTMLElement | null)[]>([]);
  const labelsRef = useRef<(string | null)[]>([]);
  const ariaRole = keepReferenceAButton(useRole(context, { role }));
  const navigation = useListNavigation(context, {
    listRef: elementsRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
    focusItemOnOpen: false,
  });
  const { open } = context;

  // The rows report their ticks in the opening commit; the microtask reads
  // the settled set, where floating-ui's own open focus would race it and
  // land on the first row.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      const rows = elementsRef.current;
      const index = pickOpenIndex(role, rows, tickedRef.current);
      const row = rows[index];
      if (row !== undefined && row !== null) {
        revealRowInPanel(row);
      }
      setActiveIndex(index);
    });
    return () => {
      cancelled = true;
    };
  }, [open, role]);
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    onMatch: setActiveIndex,
    enabled: context.open,
  });

  // Stable: every row's layout effect keys on it.
  const markSelected = useCallback((index: number, selected: boolean) => {
    if (selected) {
      tickedRef.current.add(index);
    } else {
      tickedRef.current.delete(index);
    }
  }, []);

  return {
    activeIndex,
    elementsRef,
    labelsRef,
    markSelected,
    interactions: [ariaRole, navigation, typeahead],
  };
}
