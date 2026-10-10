import type { ProgressFillStyle } from "../types";

/** Scrolls the overflowing nav only as far as brings the segment into view. */
export function revealSegment(nav: HTMLElement, segment: HTMLElement): void {
  const navBox = nav.getBoundingClientRect();
  const box = segment.getBoundingClientRect();

  if (box.left < navBox.left) {
    nav.scrollLeft -= navBox.left - box.left;
  } else if (box.right > navBox.right) {
    nav.scrollLeft += box.right - navBox.right;
  }
}

export function deriveFillStyle(fillPercent: number): ProgressFillStyle {
  return { "--fill": `${fillPercent / 100}` };
}
