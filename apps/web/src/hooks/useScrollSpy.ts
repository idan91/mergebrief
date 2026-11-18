import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

const DEFAULT_READING_LINE_PX = 150;

export interface ScrollSpySync {
  /** What the caller's store names now; other writers can move it past the spy. */
  readActive: () => string | undefined;
  /** A jump is flying, and the chunks it passes are not the reader's position. */
  isHeld: () => boolean;
  /** Reports a jump that ended, settled or cut short, which may leave no scroll event to read. Returns the remover. */
  subscribeHoldEnded: (listener: () => void) => () => void;
  /**
   * Controls act on the answer, so it has to be on screen: a layout shift with
   * no scroll re-reads it, and off every element it is the next one down while
   * that one is in view.
   */
  isExact: () => boolean;
  /**
   * An exact read found nothing on screen; `readActive` answers undefined
   * until the next write. `lastBelowLine`: the last answer now sits below the
   * reading line, so the reader scrolled up out of it.
   */
  clearActive: (lastBelowLine: boolean) => void;
  /**
   * The page scrolls no further down, so a stored chunk too short to reach
   * the line stands while it shows below the line.
   */
  isAtPageEnd: () => boolean;
}

function isBelowLine(id: string | undefined, readingLine: number): boolean {
  const element = id === undefined ? null : document.getElementById(id);
  const belowLine =
    element !== null && element.getBoundingClientRect().top >= readingLine;
  return belowLine;
}

function isShownBelowLine(
  id: string | undefined,
  readingLine: number,
): boolean {
  const element = id === undefined ? null : document.getElementById(id);
  if (element === null) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const shown = rect.bottom > readingLine && rect.top < window.innerHeight;
  return shown;
}

function findCrossing(ids: string[], readingLine: number): string | undefined {
  return ids.find((id) => {
    const element = document.getElementById(id);
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const crossesLine = rect.top <= readingLine && rect.bottom > readingLine;
    return crossesLine;
  });
}

function findOnScreen(ids: string[], readingLine: number): string | undefined {
  const atOrBelow = ids.find((id) => {
    const element = document.getElementById(id);
    const endsBelowLine =
      element !== null && element.getBoundingClientRect().bottom > readingLine;
    return endsBelowLine;
  });
  if (atOrBelow === undefined) {
    return undefined;
  }
  const top = document.getElementById(atOrBelow)?.getBoundingClientRect().top;
  const inView = top !== undefined && top < window.innerHeight;
  return inView ? atOrBelow : undefined;
}

/**
 * Generic scroll-spy: reports the id of the element currently crossing the
 * reading line (default 150px from the top) through `onActive`, state lives
 * with the caller (a store, not the hook), so a spy tick re-renders only the
 * caller's subscribers. Fires on changes to a non-null answer; while nothing
 * crosses the line the last answer stands. Pass an empty list to disable. A
 * function offset is read on every tick, for a line that follows the page.
 * `sync` compares each answer with the caller's store instead of the last one
 * reported, so a scroll that lands off an explicit write corrects it.
 */
export function useScrollSpy(
  ids: string[],
  onActive: (id: string) => void,
  offset: number | (() => number) = DEFAULT_READING_LINE_PX,
  resetKey = "",
  sync?: ScrollSpySync,
): void {
  const onActiveRef = useLatestRef(onActive);
  const offsetRef = useLatestRef(offset);
  const syncRef = useLatestRef(sync);
  // resetKey re-initialises the observer even when the id list is
  // char-identical: positional ids (c1..cN) collide across brief revisions.
  const key = `${resetKey}\n${ids.join("\n")}`;

  useEffect(() => {
    if (typeof window === "undefined" || ids.length === 0) {
      return;
    }
    let frame: number | null = null;
    let lastId: string | undefined;
    const update = () => {
      if (syncRef.current?.isHeld() === true) {
        return;
      }
      const line = offsetRef.current;
      const readingLine = typeof line === "function" ? line() : line;
      const exact = syncRef.current?.isExact() === true;
      const current = exact
        ? findOnScreen(ids, readingLine)
        : findCrossing(ids, readingLine);
      const answered =
        syncRef.current === undefined ? lastId : syncRef.current.readActive();
      const answerStands =
        syncRef.current?.isAtPageEnd() === true &&
        isShownBelowLine(answered, readingLine);
      if (current === answered || answerStands) {
        return;
      }
      lastId = current;
      if (current !== undefined) {
        onActiveRef.current(current);
      } else if (exact) {
        syncRef.current?.clearActive(isBelowLine(answered, readingLine));
      }
    };
    const scheduleUpdate = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    const layoutObserver = new ResizeObserver(() => {
      if (syncRef.current?.isExact() === true) {
        scheduleUpdate();
      }
    });
    layoutObserver.observe(document.body);
    const removeHoldEnded = syncRef.current?.subscribeHoldEnded(scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      removeHoldEnded?.();
      layoutObserver.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
    // `key` captures the id list identity without re-running on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
