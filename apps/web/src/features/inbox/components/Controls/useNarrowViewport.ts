import { useSyncExternalStore } from "react";

// Kept equal to the (width < 760px) queries in the Inbox stylesheets.
const NARROW_QUERY = "(width < 760px)";

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
