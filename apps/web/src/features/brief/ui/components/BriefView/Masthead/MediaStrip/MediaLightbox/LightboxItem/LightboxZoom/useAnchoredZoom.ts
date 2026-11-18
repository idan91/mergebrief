import { useLayoutEffect, useRef, type RefObject } from "react";

import type { ZoomAnchor, ZoomRequest } from "../../types";
import { readAnchoredScroll, readZoomAnchor } from "./utils";

/** Records where a zoom was asked, and scrolls the zoomed item to keep that point there. */
export interface AnchoredZoom {
  readonly anchorZoom: (request: ZoomRequest) => void;
}

/**
 * Once `zoomed` turns on, the point recorded by `anchorZoom` is scrolled
 * back under the pointer, before paint, so the item never shows at its top
 * left first.
 */
export function useAnchoredZoom(
  viewportRef: RefObject<HTMLElement | null>,
  itemRef: RefObject<HTMLElement | null>,
  zoomed: boolean,
): AnchoredZoom {
  const anchor = useRef<ZoomAnchor | undefined>(undefined);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const item = itemRef.current;
    const pending = anchor.current;
    anchor.current = undefined;
    const canAnchor =
      zoomed && viewport !== null && item !== null && pending !== undefined;
    if (!canAnchor) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const zoomedItem = {
      left: itemRect.left - viewportRect.left + viewport.scrollLeft,
      top: itemRect.top - viewportRect.top + viewport.scrollTop,
      width: itemRect.width,
      height: itemRect.height,
    };
    const scroll = readAnchoredScroll(pending, zoomedItem);
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
  }, [itemRef, viewportRef, zoomed]);

  function anchorZoom(request: ZoomRequest): void {
    const viewport = viewportRef.current;
    const item = itemRef.current;
    const isMounted = viewport !== null && item !== null;
    if (!isMounted) {
      return;
    }
    const itemRect = item.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    anchor.current = readZoomAnchor(request, itemRect, viewportRect);
  }

  return { anchorZoom };
}
