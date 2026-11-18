import { DRAG_THRESHOLD_PX } from "../../consts";
import type {
  DisplaySize,
  PanOffset,
  ScreenPoint,
  ScreenRect,
  ZoomAnchor,
  ZoomRequest,
} from "../../types";

const CENTRE = 0.5;

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The item scaled down to fit `box`, ratio kept; an item that already fits keeps its size. */
export function readFittedSize(
  natural: DisplaySize,
  box: DisplaySize,
): DisplaySize {
  const widthScale = box.width / natural.width;
  const heightScale = box.height / natural.height;
  const scale = Math.min(1, widthScale, heightScale);
  return {
    width: Math.floor(natural.width * scale),
    height: Math.floor(natural.height * scale),
  };
}

/** The item point a zoom keeps under the pointer; a keyboard zoom keeps the centre. */
export function readZoomAnchor(
  request: ZoomRequest,
  item: ScreenRect,
  viewport: ScreenRect,
): ZoomAnchor {
  if (request.fromKeyboard) {
    const pointerX = viewport.width * CENTRE;
    const pointerY = viewport.height * CENTRE;
    return { fractionX: CENTRE, fractionY: CENTRE, pointerX, pointerY };
  }

  const offsetX = request.clientX - item.left;
  const offsetY = request.clientY - item.top;
  return {
    fractionX: clampFraction(offsetX / item.width),
    fractionY: clampFraction(offsetY / item.height),
    pointerX: request.clientX - viewport.left,
    pointerY: request.clientY - viewport.top,
  };
}

/**
 * The scroll that puts the anchored point of the zoomed item under the
 * pointer again. `item` is the zoomed item's place in the scrolled content;
 * the browser clamps a scroll past either end.
 */
export function readAnchoredScroll(
  anchor: ZoomAnchor,
  item: ScreenRect,
): PanOffset {
  const pointX = item.left + anchor.fractionX * item.width;
  const pointY = item.top + anchor.fractionY * item.height;
  return { left: pointX - anchor.pointerX, top: pointY - anchor.pointerY };
}

/** A press became a drag: it moved past the threshold from where it started. */
export function hasDragged(start: ScreenPoint, current: ScreenPoint): boolean {
  const distance = Math.hypot(current.x - start.x, current.y - start.y);
  return distance >= DRAG_THRESHOLD_PX;
}
