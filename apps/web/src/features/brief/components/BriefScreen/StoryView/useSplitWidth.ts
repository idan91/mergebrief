import { useCallback, useState } from "react";

/** Below this the two halves cannot hold a line each; the table reads unified. */
export const SPLIT_MIN_WIDTH_PX = 500;

export type WrapperRef = (node: HTMLElement | null) => (() => void) | undefined;

export interface SplitWidth {
  /** Attach to a plain wrapper around the viewport; the diff may arrive late. */
  attachWrapper: WrapperRef;
  wideEnough: boolean;
}

/**
 * Whether the wrapper is wide enough for two sides. Observes a plain wrapper,
 * never the viewport: under `content-visibility: auto` the viewport reports
 * zero while it is skipped. Reads wide until the first measurement so SSR and
 * the first client pass agree. The observer lives in the ref callback so it
 * arms when the wrapper attaches and costs no render.
 */
export function useSplitWidth(enabled: boolean): SplitWidth {
  const [wideEnough, setWideEnough] = useState(true);

  const attachWrapper = useCallback<WrapperRef>(
    (node) => {
      if (!enabled || node === null || typeof ResizeObserver === "undefined") {
        return undefined;
      }
      // The state flip relayouts the table inside the observer's own loop,
      // which the browser reports as undelivered notifications; a frame
      // later it is an ordinary update.
      let frame = 0;
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? node.clientWidth;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          setWideEnough(width >= SPLIT_MIN_WIDTH_PX);
        });
      });
      observer.observe(node);

      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    },
    [enabled],
  );

  return { attachWrapper, wideEnough };
}
