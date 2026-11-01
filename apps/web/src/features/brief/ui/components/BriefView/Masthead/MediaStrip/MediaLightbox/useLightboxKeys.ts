import { useEffect, useRef } from "react";

import { readStepOffset } from "./utils";

/**
 * Left and right arrows step the open lightbox. A focused player keeps its
 * arrows for seeking.
 */
export function useLightboxKeys(
  open: boolean,
  onStep: (offset: number) => void,
): void {
  const latestStep = useRef(onStep);

  useEffect(() => {
    latestStep.current = onStep;
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent): void {
      const offset = readStepOffset(event);
      const playerFocused = event.target instanceof HTMLMediaElement;
      if (offset === undefined || playerFocused || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      latestStep.current(offset);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
}
