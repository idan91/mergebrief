import { useSyncExternalStore } from "react";

import { SMALL_MOBILE_BREAKPOINT_PX } from "@web/hooks/useMobileViewport";

const NARROW_QUERY = `(width < ${SMALL_MOBILE_BREAKPOINT_PX}px)`;

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(NARROW_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function readNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

function readServerNarrow(): boolean {
  return false;
}

/** Under 760px the filters collapse behind one button; wide during SSR. */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, readNarrow, readServerNarrow);
}
