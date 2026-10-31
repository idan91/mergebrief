import { useEffect, useInsertionEffect, useLayoutEffect, useRef } from "react";

import { readNumericCssVar, STICKY_STACK_HEIGHT_VAR } from "../utils";
import type { ChunkWindowRegistry } from "./chunk-windows";
import {
  findScreenAnchor,
  isAnchorCurrent,
  readAnchorDrift,
  type ScreenAnchor,
} from "./hold-card-position";
import { CHUNK_WINDOW_INDEX_ATTR } from "./useGroupWindow";

/** Frames the hold keeps correcting after the landing commit: measurement passes resize cards for a few more. */
export const HOLD_FRAMES = 12;

interface Hold {
  release: () => void;
}

function ignoreRelease(): void {}

function listWindowedCards(): Element[] {
  return [...document.querySelectorAll(`[${CHUNK_WINDOW_INDEX_ATTR}]`)];
}

function recordAnchor(slot: { current: ScreenAnchor | undefined }): void {
  slot.current = findScreenAnchor(
    listWindowedCards(),
    window.innerHeight,
    window.scrollY,
    readNumericCssVar(STICKY_STACK_HEIGHT_VAR),
  );
}

/**
 * Scrolls the page by the anchor's drift now and on the next frames, until
 * the frames run out, the page leaves the scroll its own corrections set, or
 * the hold is released; `onEnd` reports a hold that ended on its own. The
 * position, not a count of own scrolls, tells them apart: a browser fires one
 * scroll event per frame, so a jump in a correction's frame shares its event.
 */
function startHold(
  anchor: ScreenAnchor,
  releaseCompensation: () => void,
  onEnd: () => void,
): Hold {
  let framesLeft = HOLD_FRAMES;
  let heldScrollY = window.scrollY;
  let frame: number | undefined;
  let released = false;

  const correct = (): void => {
    const drift = readAnchorDrift(anchor);
    if (drift !== 0) {
      window.scrollBy({ top: drift, behavior: "instant" });
      heldScrollY = window.scrollY;
    }
  };
  const stopIfScrolledAway = (): void => {
    if (window.scrollY !== heldScrollY) {
      framesLeft = 0;
    }
  };
  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }
    window.removeEventListener("scroll", stopIfScrolledAway);
    releaseCompensation();
  };
  const tick = (): void => {
    frame = undefined;
    stopIfScrolledAway();
    framesLeft -= 1;
    if (framesLeft <= 0) {
      release();
      onEnd();
      return;
    }
    correct();
    frame = window.requestAnimationFrame(tick);
  };

  window.addEventListener("scroll", stopIfScrolledAway, { passive: true });
  correct();
  frame = window.requestAnimationFrame(tick);
  return { release };
}

/**
 * Keeps the card on screen in place when the code lands: the anchor is
 * re-read on every scroll, layout change and commit while the code is
 * pending, the landing commit scrolls the page by its drift before paint and
 * keeps correcting for a few frames, and a scroll the reader makes ends the
 * hold. The windows'
 * compensation is held off meanwhile: twenty groups each correcting against
 * a stale list offset throw the page tens of thousands of pixels. A landing
 * during a programmatic smooth scroll holds nothing: a correction cancels it.
 */
export function useHeldCardPosition(
  codePending: boolean,
  windows: ChunkWindowRegistry | undefined,
): void {
  const anchor = useRef<ScreenAnchor | undefined>(undefined);
  const wasPending = useRef(codePending);
  const hold = useRef<Hold | undefined>(undefined);
  const landingCompensation = useRef<(() => void) | undefined>(undefined);

  // Before the commit attaches refs, where the windows measure their cards.
  useInsertionEffect(() => {
    const landing = wasPending.current && !codePending;
    if (landing && windows !== undefined) {
      landingCompensation.current?.();
      landingCompensation.current = windows.holdScrollCompensation();
    }
  }, [codePending, windows]);

  useEffect(() => {
    if (!codePending) {
      return;
    }
    const onLayoutChange = () => recordAnchor(anchor);
    window.addEventListener("scroll", onLayoutChange, { passive: true });
    // A thread expanding above the card or a resize moves it without a scroll.
    const layout = new ResizeObserver(onLayoutChange);
    layout.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onLayoutChange);
      layout.disconnect();
    };
  }, [codePending]);

  // A re-render during the hold must not end it, so the hold lives in a ref
  // and only the next landing or the unmount releases it.
  useLayoutEffect(() => {
    const landing = wasPending.current && !codePending;
    wasPending.current = codePending;
    if (codePending) {
      recordAnchor(anchor);
      return;
    }
    if (!landing) {
      return;
    }

    const releaseCompensation = landingCompensation.current ?? ignoreRelease;
    landingCompensation.current = undefined;
    hold.current?.release();
    hold.current = undefined;
    const held = anchor.current;
    anchor.current = undefined;
    const smoothScrolling = windows?.isSmoothScrolling() === true;
    const holdsCard =
      held !== undefined &&
      !smoothScrolling &&
      isAnchorCurrent(held, window.scrollY);
    if (!holdsCard) {
      releaseCompensation();
      return;
    }
    hold.current = startHold(held, releaseCompensation, () => {
      hold.current = undefined;
    });
  });

  useEffect(
    () => () => {
      hold.current?.release();
      hold.current = undefined;
      landingCompensation.current?.();
      landingCompensation.current = undefined;
    },
    [],
  );
}
