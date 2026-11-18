import { FLASH_MS, SCROLL_FLASH_ATTR } from "./consts";
import type { Flash } from "./types";

export function createFlash(): Flash {
  return { element: undefined, frame: undefined, timer: undefined };
}

export function stopFlash(flash: Flash): void {
  if (flash.frame !== undefined) {
    window.cancelAnimationFrame(flash.frame);
    flash.frame = undefined;
  }
  if (flash.timer !== undefined) {
    window.clearTimeout(flash.timer);
    flash.timer = undefined;
  }
  flash.element?.removeAttribute(SCROLL_FLASH_ATTR);
  flash.element = undefined;
}

/** The attribute is dropped for a frame, so a repeat scroll restarts the animation. */
export function startFlash(flash: Flash, element: HTMLElement): void {
  stopFlash(flash);
  flash.element = element;
  flash.frame = window.requestAnimationFrame(() => {
    flash.frame = undefined;
    element.setAttribute(SCROLL_FLASH_ATTR, "");
    flash.timer = window.setTimeout(() => stopFlash(flash), FLASH_MS);
  });
}
