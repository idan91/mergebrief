import { useSyncExternalStore } from "react";
import type { ValueOf } from "types/utils";

// Kept equal to $breakpoints.tablet in styles/_functions.scss by styles/breakpoints.test.ts.
export const TABLET_BREAKPOINT_PX = 1120;

export const ViewportBands = {
  DESKTOP: "desktop",
  NARROW: "narrow",
} as const;

export type ViewportBand = ValueOf<typeof ViewportBands>;

const NARROW_QUERY = `(width <= ${TABLET_BREAKPOINT_PX}px)`;

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(NARROW_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function readBand(): ViewportBand {
  return window.matchMedia(NARROW_QUERY).matches
    ? ViewportBands.NARROW
    : ViewportBands.DESKTOP;
}

function readServerBand(): ViewportBand {
  return ViewportBands.DESKTOP;
}

/** Which side of the tablet breakpoint the viewport is on; desktop during SSR. */
export function useViewportBoundary(): ViewportBand {
  return useSyncExternalStore(subscribe, readBand, readServerBand);
}
