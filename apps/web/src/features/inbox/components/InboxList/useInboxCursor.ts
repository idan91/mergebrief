import { useEffect, useState } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { isTypingTarget } from "../../../../utils/typingTarget";

const NO_CURSOR = -1;
const STEP_BY_KEY: Record<string, number> = {
  j: 1,
  ArrowDown: 1,
  k: -1,
  ArrowUp: -1,
};
const OVERLAY_SELECTOR =
  '[role="menu"], [aria-expanded="true"], [role="dialog"]';

function hasModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/** One step from the cursor, held inside the rows; up from nowhere stays nowhere. */
function readNextCursor(current: number, step: number, last: number): number {
  if (last < 0) {
    return NO_CURSOR;
  }
  if (current === NO_CURSOR) {
    return step > 0 ? 0 : NO_CURSOR;
  }
  return Math.min(last, Math.max(0, current + step));
}

/** A key inside an open menu or dialog belongs to it, never to the list. */
function isInsideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;
}

/**
 * The keyboard cursor over the page's rows: j, k and the arrows move it,
 * stopping at either end; Enter opens the row under it. The cursor is the
 * index into the rows as rendered, above the fold then below it, and it
 * never animates. It returns -1 while no key has placed it, and a shorter
 * list pulls it back onto its last row. A key that would not move the
 * cursor is left to the page, so the arrows still scroll past either end.
 */
export function useInboxCursor(
  count: number,
  onOpen: (index: number) => void,
): number {
  const [cursor, setCursor] = useState(NO_CURSOR);
  const last = count - 1;
  const latestOpen = useLatestRef(onOpen);
  const latestCursor = useLatestRef(cursor);

  useEffect(() => {
    if (cursor > last) {
      setCursor(Math.max(NO_CURSOR, last));
    }
  }, [cursor, last]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (hasModifier(event) || isTypingTarget(event.target)) {
        return;
      }
      if (isInsideOverlay(event.target)) {
        return;
      }

      const current = latestCursor.current;
      const step = STEP_BY_KEY[event.key];
      if (step !== undefined) {
        const next = readNextCursor(current, step, last);
        if (next === current) {
          return;
        }
        event.preventDefault();
        setCursor(next);
        return;
      }

      if (event.key !== "Enter" || current === NO_CURSOR) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("a, button")
      ) {
        return;
      }
      event.preventDefault();
      latestOpen.current(current);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [last, latestCursor, latestOpen]);

  return cursor;
}
