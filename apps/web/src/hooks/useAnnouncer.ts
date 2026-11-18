import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Text for one persistent polite live region. A repeat of the same words
 * is a DOM change only if the region empties first, so every announcement
 * clears on one frame and lands on the next; the region itself must stay
 * mounted, since a region inserted with its text is never read.
 */
export function useAnnouncer() {
  const [text, setText] = useState("");
  const frame = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (frame.current !== undefined) {
        window.cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

  const announce = useCallback((next: string): void => {
    if (frame.current !== undefined) {
      window.cancelAnimationFrame(frame.current);
    }

    setText("");
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined;
      setText(next);
    });
  }, []);

  return { text, announce };
}
