import { useEffect, useState } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { isInsideOverlay } from "../../../../utils/overlay-target";
import { isTypingTarget } from "../../../../utils/typingTarget";
import { isSuppressedSingleKey } from "@web/utils/single-key-shortcuts";
import type { InboxCursor } from "./types";

const NO_CURSOR = -1;
const STEP_BY_KEY: Record<string, number> = {
  j: 1,
  ArrowDown: 1,
  k: -1,
  ArrowUp: -1,
};

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

/** The cursor's last placement: the row it is on and where that row sat. */
interface CursorPlacement extends InboxCursor {
  readonly rowKey: string | undefined;
}

const UNPLACED: CursorPlacement = {
  rowKey: undefined,
  index: NO_CURSOR,
  moveCount: 0,
};

/**
 * The row the placement is on, wherever it sits now; when that row left,
 * whatever row took its place, pulled back onto the last row.
 */
function resolveCursorIndex(
  placement: CursorPlacement,
  rowKeys: readonly string[],
): number {
  const found =
    placement.rowKey === undefined
      ? NO_CURSOR
      : rowKeys.indexOf(placement.rowKey);
  if (found !== NO_CURSOR) {
    return found;
  }
  return Math.min(placement.index, rowKeys.length - 1);
}

/**
 * The keyboard cursor over the page's rows: j, k and the arrows move it,
 * stopping at either end; Enter opens the row under it, x ticks or unticks
 * it. It stays on its row when a re-read adds or removes rows above it; when
 * its own row leaves, the row in its place takes it, and a shorter list pulls
 * it back onto its last row. The index counts rows as rendered and is -1
 * until a key places it; `moveCount` counts key moves only. A key that would
 * not move the cursor is left to the page, so the arrows scroll past an end.
 */
export function useInboxCursor(
  rowKeys: readonly string[],
  onOpen: (index: number) => void,
  onToggleSelect?: (index: number) => void,
): InboxCursor {
  const [placement, setPlacement] = useState(UNPLACED);
  const index = resolveCursorIndex(placement, rowKeys);
  const rowKey = rowKeys[index];
  // Adjusted during render, not in an effect: a re-read that moved the row,
  // or took it away, re-pins the cursor before anything paints.
  const shifted = placement.rowKey !== rowKey || placement.index !== index;
  if (shifted) {
    setPlacement({ ...placement, rowKey, index });
  }
  const latestRowKeys = useLatestRef(rowKeys);
  const latestOpen = useLatestRef(onOpen);
  const latestToggle = useLatestRef(onToggleSelect);
  const latestIndex = useLatestRef(index);

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (hasModifier(event) || isTypingTarget(event.target)) {
        return;
      }
      if (isInsideOverlay(event.target) || isSuppressedSingleKey(event)) {
        return;
      }

      const current = latestIndex.current;
      const step = STEP_BY_KEY[event.key];
      if (step !== undefined) {
        const keys = latestRowKeys.current;
        const next = readNextCursor(current, step, keys.length - 1);
        if (next === current) {
          return;
        }
        event.preventDefault();
        setPlacement((previous) => ({
          rowKey: keys[next],
          index: next,
          moveCount: previous.moveCount + 1,
        }));
        return;
      }

      if (event.key === "x" && current !== NO_CURSOR) {
        event.preventDefault();
        latestToggle.current?.(current);
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
  }, [latestIndex, latestOpen, latestRowKeys, latestToggle]);

  return { index, moveCount: placement.moveCount };
}
