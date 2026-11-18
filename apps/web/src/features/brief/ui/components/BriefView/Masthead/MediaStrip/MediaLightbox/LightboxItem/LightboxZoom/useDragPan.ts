import { useRef, useState, type PointerEvent, type RefObject } from "react";

import type { ScreenPoint } from "../../types";
import { hasDragged } from "./utils";

const MOUSE_PRIMARY_BUTTON = 0;
const TOUCH_POINTER = "touch";

interface DragStart {
  readonly pointerId: number;
  readonly point: ScreenPoint;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  moved: boolean;
}

/** The drag pan's state and its handlers for the viewport. */
export interface DragPan {
  readonly dragging: boolean;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  /** True once for a click that ends a drag, which then leaves the zoom as it is. */
  readonly takeEndedDrag: () => boolean;
}

/**
 * While `panning`, a mouse or pen drag scrolls the viewport; a press that
 * never moves past the threshold stays a click. Touch keeps the browser's
 * own scrolling, which already pans with one finger and sends no click
 * after a scroll.
 */
export function useDragPan(
  viewportRef: RefObject<HTMLElement | null>,
  panning: boolean,
): DragPan {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragStart | undefined>(undefined);
  const endedDrag = useRef(false);

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    const viewport = viewportRef.current;
    const isMousePress =
      event.pointerType !== TOUCH_POINTER &&
      event.button === MOUSE_PRIMARY_BUTTON;
    endedDrag.current = false;
    const canDrag = panning && viewport !== null && isMousePress;
    if (!canDrag) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    const { scrollLeft, scrollTop } = viewport;
    drag.current = {
      pointerId: event.pointerId,
      point,
      scrollLeft,
      scrollTop,
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const start = drag.current;
    const viewport = viewportRef.current;
    const isTrackedPointer =
      start?.pointerId === event.pointerId && viewport !== null;
    if (!isTrackedPointer) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    const startsDrag = !start.moved && hasDragged(start.point, point);
    if (startsDrag) {
      start.moved = true;
      setDragging(true);
      viewport.setPointerCapture(event.pointerId);
    }
    if (start.moved) {
      viewport.scrollLeft = start.scrollLeft - (point.x - start.point.x);
      viewport.scrollTop = start.scrollTop - (point.y - start.point.y);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLElement>): void {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) {
      return;
    }
    endedDrag.current = start.moved;
    drag.current = undefined;
    setDragging(false);
  }

  function takeEndedDrag(): boolean {
    const ended = endedDrag.current;
    endedDrag.current = false;
    return ended;
  }

  return { dragging, onPointerDown, onPointerMove, onPointerUp, takeEndedDrag };
}
