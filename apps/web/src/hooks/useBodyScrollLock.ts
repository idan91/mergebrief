import { useEffect } from "react";

// Two sheets can be up at once, and they do not close in the order they opened.
let lockCount = 0;
let overflowBeforeLock = "";
let gutterBeforeLock = "";

function readScrollbarWidth(): number {
  return window.innerWidth - document.documentElement.clientWidth;
}

/** Holds the page still behind a modal surface; releases on unmount or when inactive. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    if (lockCount === 0) {
      const root = document.documentElement;
      overflowBeforeLock = document.body.style.overflow;
      gutterBeforeLock = root.style.scrollbarGutter;
      // The gutter stands in for the scrollbar the lock removes, so the page
      // keeps its width; a page without a classic scrollbar must not gain one.
      if (readScrollbarWidth() > 0) {
        root.style.scrollbarGutter = "stable";
      }
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = overflowBeforeLock;
        document.documentElement.style.scrollbarGutter = gutterBeforeLock;
      }
    };
  }, [active]);
}
