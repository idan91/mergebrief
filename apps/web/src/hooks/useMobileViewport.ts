import { useSyncExternalStore } from "react";

// Kept equal to $breakpoints.mobile in styles/_functions.scss by styles/breakpoints.test.ts.
export const MOBILE_BREAKPOINT_PX = 880;

export const MOBILE_QUERY = `(width <= ${MOBILE_BREAKPOINT_PX}px)`;

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(MOBILE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function readMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function readServerMobile(): boolean {
  return false;
}

/** At or under the mobile breakpoint, as `for-breakpoint("mobile", max)` reads it; wide during SSR. */
export function useMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, readMobile, readServerMobile);
}
