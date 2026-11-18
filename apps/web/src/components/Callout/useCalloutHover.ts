import { useEffect, useRef, useState, type PointerEvent } from "react";

import { CALLOUT_HOVER_DELAY_MS } from "./consts";
import type { CalloutHover } from "./types";
import { areCalloutsWarm } from "./utils";

/**
 * The hover half of a callout: open after a pointer has rested on the
 * anchor for the delay, at once while another callout is warm, never for a touch (it gets no leave until the
 * finger lifts, so a callout it opened would have no close), and cleared
 * when the anchor unmounts. The caller mounts `Callout` while `open` and
 * hands it `close`; the callout's own hover system decides when to leave.
 */
export function useCalloutHover(): CalloutHover {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function arm(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      return;
    }
    window.clearTimeout(timer.current);
    if (areCalloutsWarm()) {
      setOpen(true);
      return;
    }
    timer.current = window.setTimeout(
      () => setOpen(true),
      CALLOUT_HOVER_DELAY_MS,
    );
  }

  function disarm(): void {
    window.clearTimeout(timer.current);
  }

  // An explicit open or close outranks a rest still counting: a blur must
  // not be undone by the timer a pointer armed before the focus.
  function show(): void {
    window.clearTimeout(timer.current);
    setOpen(true);
  }

  function close(): void {
    window.clearTimeout(timer.current);
    setOpen(false);
  }

  return { open, arm, disarm, show, close };
}
