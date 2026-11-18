import { useEffect, useState, type RefObject } from "react";

import type { DisplaySize } from "../../types";

/** The element's inner size, kept current as the dialog resizes; absent until it mounts. */
export function useViewportBox(
  viewportRef: RefObject<HTMLElement | null>,
): DisplaySize | undefined {
  const [box, setBox] = useState<DisplaySize>();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return undefined;
    }
    function measure(element: HTMLElement): void {
      setBox({ width: element.clientWidth, height: element.clientHeight });
    }

    measure(viewport);
    const observer = new ResizeObserver(() => {
      measure(viewport);
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, [viewportRef]);

  return box;
}
