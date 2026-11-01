import { useRef, useState, type MouseEvent } from "react";

import type { DisplaySize } from "../../types";
import { isLargerThanBox } from "../../utils";
import { useAnchoredZoom } from "./useAnchoredZoom";
import { useArrowPan } from "./useArrowPan";
import { useDragPan } from "./useDragPan";
import { useViewportBox } from "./useViewportBox";
import { readFittedSize } from "./utils";

/** A click's `detail` is 0 when a key, not a pointer, pressed the control. */
const KEYBOARD_CLICK_DETAIL = 0;

/**
 * Fit or actual size for one open item. Only an item whose own pixels
 * outgrow the stage zooms; a click zooms anchored at the clicked point, and
 * while zoomed a click that was no drag returns to fit. Resizing re-fits.
 */
export function useLightboxZoomFacade(naturalSize: DisplaySize | undefined) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const box = useViewportBox(viewportRef);
  const [zoomChosen, setZoomChosen] = useState(false);

  const zoomable =
    naturalSize !== undefined &&
    box !== undefined &&
    isLargerThanBox(naturalSize, box);
  const zoomed = zoomable && zoomChosen;
  const fittedSize =
    naturalSize === undefined || box === undefined
      ? undefined
      : readFittedSize(naturalSize, box);
  const itemSize = zoomed ? naturalSize : fittedSize;

  useArrowPan(viewportRef, zoomed);
  const dragPan = useDragPan(viewportRef, zoomed);
  const { anchorZoom } = useAnchoredZoom(viewportRef, itemRef, zoomed);

  function onToggleClick(event: MouseEvent<HTMLElement>): void {
    if (zoomed) {
      if (!dragPan.takeEndedDrag()) {
        setZoomChosen(false);
      }
      return;
    }

    const fromKeyboard = event.detail === KEYBOARD_CLICK_DETAIL;
    anchorZoom({
      clientX: event.clientX,
      clientY: event.clientY,
      fromKeyboard,
    });
    setZoomChosen(true);
  }

  return {
    viewportRef,
    itemRef,
    zoomable,
    zoomed,
    itemSize,
    dragging: dragPan.dragging,
    onToggleClick,
    onPointerDown: dragPan.onPointerDown,
    onPointerMove: dragPan.onPointerMove,
    onPointerUp: dragPan.onPointerUp,
  };
}
