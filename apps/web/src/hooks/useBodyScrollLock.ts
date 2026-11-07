import { useEffect } from "react";

// Two sheets can be up at once, and they do not close in the order they opened.
let lockCount = 0;
let overflowBeforeLock = "";

/** Holds the page still behind a modal surface; releases on unmount or when inactive. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    if (lockCount === 0) {
      overflowBeforeLock = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = overflowBeforeLock;
      }
    };
  }, [active]);
}
