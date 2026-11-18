import { act } from "@testing-library/react";

import { intersectionObservers } from "./setup";

const STICKY_HEIGHT_PX = 48;

/** Makes whatever `selector` matches sticky at `topPx`, which jsdom's empty stylesheet never is. */
export function stubStickyRule(
  selector: string,
  topPx: number,
): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `${selector} { position: sticky; top: ${String(topPx)}px; }`;
  document.head.append(style);
  return style;
}

/** Reports `target` at `top` to the live observer watching the line one pixel under `stickyTopPx`. */
export function placeStickyTarget(
  target: Element,
  stickyTopPx: number,
  top: number,
): void {
  const line = stickyTopPx + 1;
  const observer = intersectionObservers.findLast(
    (record) =>
      !record.disconnected &&
      record.rootMargin.startsWith(`-${String(line)}px `),
  );
  if (observer === undefined) {
    throw new Error(`nothing watches the line at ${String(line)}px`);
  }
  act(() => {
    observer.callback(
      [
        {
          target,
          isIntersecting: top + STICKY_HEIGHT_PX > line,
          boundingClientRect: { top, height: STICKY_HEIGHT_PX },
          rootBounds: { top: line },
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}
