import { useSyncExternalStore } from "react";

import { LANDSCAPE_PHONE_QUERY, MOBILE_QUERY } from "../useMobileViewport";
import { ViewportShapes, type ViewportShape } from "./types";

function subscribe(onChange: () => void): () => void {
  const lists = [
    window.matchMedia(MOBILE_QUERY),
    window.matchMedia(LANDSCAPE_PHONE_QUERY),
  ];
  for (const list of lists) {
    list.addEventListener("change", onChange);
  }
  return () => {
    for (const list of lists) {
      list.removeEventListener("change", onChange);
    }
  };
}

function readShape(): ViewportShape {
  if (window.matchMedia(LANDSCAPE_PHONE_QUERY).matches) {
    return ViewportShapes.LANDSCAPE_PHONE;
  }
  if (window.matchMedia(MOBILE_QUERY).matches) {
    return ViewportShapes.PHONE;
  }
  return ViewportShapes.DESKTOP;
}

function readServerShape(): ViewportShape {
  return ViewportShapes.DESKTOP;
}

/** The shape height estimates are sized for; desktop during SSR, like `useMobileViewport`. Never a layout switch. */
export function useViewportShape(): ViewportShape {
  return useSyncExternalStore(subscribe, readShape, readServerShape);
}
