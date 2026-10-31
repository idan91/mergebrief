import { useSyncExternalStore } from "react";

function subscribeToNothing(): () => void {
  return () => {};
}

function readClientSnapshot(): boolean {
  return true;
}

function readServerSnapshot(): boolean {
  return false;
}

/**
 * False on the server and through hydration, true on every client render
 * after: a value read from the viewer's own clock or time zone renders only
 * then, so the server's text and the first client text agree.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    readClientSnapshot,
    readServerSnapshot,
  );
}
