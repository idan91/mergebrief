import { ARROW_PAN_PX, SAME_SIZE_TOLERANCE_PX } from "./consts";
import type { DisplaySize, PanOffset } from "./types";

type ArrowKeyEvent = Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

const PAN_OFFSETS: Readonly<Record<string, PanOffset>> = {
  ArrowLeft: { left: -ARROW_PAN_PX, top: 0 },
  ArrowRight: { left: ARROW_PAN_PX, top: 0 },
  ArrowUp: { left: 0, top: -ARROW_PAN_PX },
  ArrowDown: { left: 0, top: ARROW_PAN_PX },
};

function isModified(event: ArrowKeyEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

/** The places a plain left or right arrow moves the lightbox; a modified arrow belongs to the browser. */
export function readStepOffset(event: ArrowKeyEvent): number | undefined {
  if (isModified(event)) {
    return undefined;
  }
  if (event.key === "ArrowLeft") {
    return -1;
  }
  if (event.key === "ArrowRight") {
    return 1;
  }
  return undefined;
}

/** How far a plain arrow pans an item shown at actual size; a modified arrow belongs to the browser. */
export function readPanOffset(event: ArrowKeyEvent): PanOffset | undefined {
  return isModified(event) ? undefined : PAN_OFFSETS[event.key];
}

/** Whether `size` is wider or taller than `box`, so fitting it shrinks it. */
export function isLargerThanBox(size: DisplaySize, box: DisplaySize): boolean {
  const wider = size.width - box.width > SAME_SIZE_TOLERANCE_PX;
  const taller = size.height - box.height > SAME_SIZE_TOLERANCE_PX;
  return wider || taller;
}
