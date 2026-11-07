import { useSyncExternalStore } from "react";

import { TABLET_BREAKPOINT_PX } from "./useViewportBoundary";

// Kept equal to $breakpoints.mobile in styles/_functions.scss by styles/breakpoints.test.ts.
export const MOBILE_BREAKPOINT_PX = 880;

// Kept equal to $breakpoints.landscape-height in styles/_functions.scss by styles/breakpoints.test.ts.
export const LANDSCAPE_HEIGHT_PX = 500;

/**
 * A phone held sideways, as `for-landscape-phone` reads it: short, no wider
 * than a tablet, and touched. Height keys it because a large phone lands
 * past the mobile width; the coarse pointer keeps a short desktop window out,
 * and the orientation a split-screen portrait pane.
 */
// oxlint-disable-next-line house/no-shout-case-copy -- a media query, not copy
export const LANDSCAPE_PHONE_QUERY = `(orientation: landscape) and (height <= ${LANDSCAPE_HEIGHT_PX}px) and (width <= ${TABLET_BREAKPOINT_PX}px) and (pointer: coarse)`;

/** Any phone, as `for-phone` reads it: the portrait width or the landscape shape. */
export const MOBILE_QUERY = `(width <= ${MOBILE_BREAKPOINT_PX}px), ${LANDSCAPE_PHONE_QUERY}`;

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

/** A phone held sideways right now, for code answering an event, never a render. */
export function readLandscapePhone(): boolean {
  return window.matchMedia(LANDSCAPE_PHONE_QUERY).matches;
}

/** At or under the mobile breakpoint or a phone held sideways; wide during SSR. */
export function useMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, readMobile, readServerMobile);
}
