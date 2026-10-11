import { useEffect, useState } from "react";

/**
 * Whether the page's large title block has scrolled fully under the bar,
 * whose height margins the observer. A block the layout hides has no box
 * and never counts as out; no block at all, as in focus mode, always does,
 * so the bar holds the title. Re-observes when the bar height or the block
 * changes.
 */
export function useLargeTitleOut(
  barHeight: number,
  block: HTMLElement | null,
): boolean {
  const [out, setOut] = useState(false);

  useEffect(() => {
    if (block === null) {
      setOut(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry === undefined) {
          return;
        }
        const line = entry.rootBounds?.top ?? barHeight;
        const { bottom, height } = entry.boundingClientRect;
        const scrolledUnder = height > 0 && bottom <= line;
        setOut(scrolledUnder);
      },
      { rootMargin: `-${String(barHeight)}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(block);
    return () => observer.disconnect();
  }, [barHeight, block]);

  return out;
}
